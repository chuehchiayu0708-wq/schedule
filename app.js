import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, writeBatch,
  query, orderBy, onSnapshot, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 1. 已修正 apiKey 拼字並填入你的 Firebase 設定
const firebaseConfig = {
  apiKey: "AIzaSyDhYzayWMLzJdZGLwymhY3hfxCl6tw4qtE",
  authDomain: "schedule-bc89e.firebaseapp.com",
  projectId: "schedule-bc89e",
  storageBucket: "schedule-bc89e.firebasestorage.app",
  messagingSenderId: "772996974911",
  appId: "1:772996974911:web:a840bfa3f719c5683bab8a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM 元素
const statusEl = document.getElementById('sync-status');
const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const tagSelect = document.getElementById('tag-select');
const dueDateInput = document.getElementById('due-date-input');
const todoListEl = document.getElementById('todo-list');
const notifyBtn = document.getElementById('notify-btn');
const bgBtn = document.getElementById('bg-btn');
const bgFileInput = document.getElementById('bg-file-input');
const customBgLayer = document.getElementById('custom-bg-layer');

let currentUser = null;
let allTodos = [];
let currentFilter = 'all';
let notifiedIds = new Set();

// ==========================================
// 自訂背景邏輯（支援相簿選圖、自動壓縮與重置）
// ==========================================
const savedBg = localStorage.getItem('pwa_custom_bg');
if (savedBg && customBgLayer) {
  customBgLayer.style.backgroundImage = `url(${savedBg})`;
}

if (bgBtn && bgFileInput) {
  bgBtn.addEventListener('click', () => {
    if (localStorage.getItem('pwa_custom_bg')) {
      const reset = confirm("要「恢復預設漸層背景」請按確定；要「挑選新照片」請按取消。");
      if (reset) {
        localStorage.removeItem('pwa_custom_bg');
        customBgLayer.style.backgroundImage = '';
        return;
      }
    }
    bgFileInput.click();
  });

  bgFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 1280;
        let width = img.width;
        let height = img.height;

        if (width > height && width > maxDim) {
          height *= maxDim / width;
          width = maxDim;
        } else if (height > maxDim) {
          width *= maxDim / height;
          height = maxDim;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.78);
        try {
          localStorage.setItem('pwa_custom_bg', compressedDataUrl);
          customBgLayer.style.backgroundImage = `url(${compressedDataUrl})`;
        } catch (err) {
          alert("照片檔案過大無法儲存，請換一張較小的圖片。");
        }
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });
}

// ==========================================
// Firebase 驗證與資料監聽
// ==========================================
statusEl.textContent = "正在驗證身分...";
signInAnonymously(auth).catch((error) => {
  statusEl.textContent = `驗證失敗: ${error.code}`;
  console.error("Auth Error:", error);
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    statusEl.textContent = "連線資料庫中...";
    listenToTodos(user.uid);
  }
});

function listenToTodos(uid) {
  const todosRef = collection(db, "users", uid, "todos");
  const q = query(todosRef, orderBy("order", "asc"));

  onSnapshot(q, (snapshot) => {
    statusEl.textContent = "已連線並即時同步";
    allTodos = [];
    snapshot.forEach((docSnap) => {
      allTodos.push({ id: docSnap.id, ...docSnap.data() });
    });
    renderList();
  }, (error) => {
    statusEl.textContent = `同步錯誤: ${error.code}`;
    console.error("Firestore Error:", error);
  });
}

// ==========================================
// 渲染清單與篩選
// ==========================================
function renderList() {
  todoListEl.innerHTML = '';
  const filtered = currentFilter === 'all' 
    ? allTodos 
    : allTodos.filter(t => t.tag === currentFilter);

  filtered.forEach(todo => {
    todoListEl.appendChild(createTodoElement(todo));
  });
}

document.querySelectorAll('.filter-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.tag;
    renderList();
  });
});

// ==========================================
// 新增待辦
// ==========================================
todoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = todoInput.value.trim();
  if (!text) return;
  if (!currentUser) {
    alert("尚未連線完成，請稍候再試");
    return;
  }

  const tag = tagSelect.value;
  const dueDate = dueDateInput.value || null;
  todoInput.value = '';
  dueDateInput.value = '';

  const minOrder = allTodos.length > 0 ? Math.min(...allTodos.map(t => t.order || 0)) : 0;

  try {
    await addDoc(collection(db, "users", currentUser.uid, "todos"), {
      text,
      tag,
      dueDate,
      completed: false,
      order: minOrder - 1000,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    alert(`新增失敗：${err.message}`);
  }
});

// ==========================================
// 建立單張卡片與左滑手勢
// ==========================================
function createTodoElement(todo) {
  const wrapper = document.createElement('li');
  wrapper.className = `todo-wrapper ${todo.completed ? 'completed' : ''}`;
  wrapper.dataset.id = todo.id;

  const deleteBg = document.createElement('div');
  deleteBg.className = 'swipe-delete-bg';
  deleteBg.textContent = '放開刪除';

  const card = document.createElement('div');
  card.className = 'todo-card';

  const checkBtn = document.createElement('div');
  checkBtn.className = 'check-circle';
  checkBtn.onclick = () => updateDoc(doc(db, "users", currentUser.uid, "todos", todo.id), {
    completed: !todo.completed
  });

  const content = document.createElement('div');
  content.className = 'todo-content';
  
  const textEl = document.createElement('div');
  textEl.className = 'todo-text';
  textEl.textContent = todo.text;

  const meta = document.createElement('div');
  meta.className = 'todo-meta';

  const tagBadge = document.createElement('span');
  tagBadge.className = `tag-badge tag-${todo.tag}`;
  tagBadge.textContent = todo.tag;
  meta.appendChild(tagBadge);

  if (todo.dueDate) {
    const dueEl = document.createElement('span');
    dueEl.className = 'due-text';
    dueEl.textContent = `⏰ ${todo.dueDate.replace('T', ' ')}`;
    meta.appendChild(dueEl);
  }

  const calBtn = document.createElement('button');
  calBtn.className = 'cal-btn';
  calBtn.textContent = '📅 行事曆';
  calBtn.onclick = (e) => {
    e.stopPropagation();
    exportToAppleCalendar(todo);
  };
  meta.appendChild(calBtn);

  content.appendChild(textEl);
  content.appendChild(meta);

  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.innerHTML = '≡';

  card.appendChild(checkBtn);
  card.appendChild(content);
  card.appendChild(handle);
  wrapper.appendChild(deleteBg);
  wrapper.appendChild(card);

  attachSwipeToDelete(card, todo.id);
  return wrapper;
}

function attachSwipeToDelete(cardEl, todoId) {
  let startX = 0;
  let currentX = 0;
  let isSwiping = false;

  cardEl.addEventListener('touchstart', (e) => {
    if (e.target.classList.contains('drag-handle')) return;
    startX = e.touches[0].clientX;
    isSwiping = true;
    cardEl.style.transition = 'none';
  }, { passive: true });

  cardEl.addEventListener('touchmove', (e) => {
    if (!isSwiping) return;
    const diffX = e.touches[0].clientX - startX;
    if (diffX < 0) {
      currentX = diffX;
      cardEl.style.transform = `translateX(${currentX}px)`;
    }
  }, { passive: true });

  cardEl.addEventListener('touchend', async () => {
    if (!isSwiping) return;
    isSwiping = false;
    cardEl.style.transition = 'transform 0.2s ease-out';

    if (currentX < -110) {
      cardEl.style.transform = 'translateX(-100%)';
      setTimeout(async () => {
        await deleteDoc(doc(db, "users", currentUser.uid, "todos", todoId));
      }, 180);
    } else {
      cardEl.style.transform = 'translateX(0)';
    }
    currentX = 0;
  });
}

// ==========================================
// 拖曳排序
// ==========================================
Sortable.create(todoListEl, {
  handle: '.drag-handle',
  animation: 180,
  onEnd: async () => {
    if (!currentUser) return;
    const items = Array.from(todoListEl.children);
    const batch = writeBatch(db);
    items.forEach((li, index) => {
      const id = li.dataset.id;
      const docRef = doc(db, "users", currentUser.uid, "todos", id);
      batch.update(docRef, { order: index * 1000 });
    });
    await batch.commit();
  }
});

// ==========================================
// Apple 行事曆匯出 (.ics)
// ==========================================
function exportToAppleCalendar(todo) {
  const startDate = todo.dueDate ? new Date(todo.dueDate) : new Date(Date.now() + 3600000);
  const endDate = new Date(startDate.getTime() + 3600000);
  const formatICSDate = (date) => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Personal PWA Todo//TW',
    'BEGIN:VEVENT',
    `UID:${todo.id}@personal-pwa`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `DTSTART:${formatICSDate(startDate)}`,
    `DTEND:${formatICSDate(endDate)}`,
    `SUMMARY:[${todo.tag}] ${todo.text}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${todo.text}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==========================================
// 系統通知
// ==========================================
notifyBtn.addEventListener('click', async () => {
  if (!('Notification' in window)) {
    alert('請先將此網頁「加入主畫面」後再開啟通知功能');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    notifyBtn.textContent = '🔔 已開啟';
    new Notification('通知已啟用', { body: '到期任務將會透過系統橫幅提醒你！' });
  }
});

setInterval(() => {
  if (Notification.permission !== 'granted') return;
  const now = Date.now();
  allTodos.forEach(todo => {
    if (!todo.completed && todo.dueDate && !notifiedIds.has(todo.id)) {
      const dueTime = new Date(todo.dueDate).getTime();
      if (now >= dueTime && now - dueTime < 60000) {
        new Notification(`⏰ [${todo.tag}] 任務提醒`, { body: todo.text });
        notifiedIds.add(todo.id);
      }
    }
  });
}, 30000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}