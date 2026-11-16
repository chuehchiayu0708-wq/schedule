import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
  initializeFirestore, persistentLocalCache,
  collection, addDoc, updateDoc, deleteDoc, doc, writeBatch,
  query, orderBy, onSnapshot, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 1. 填入你的 Firebase 設定
const firebaseConfig = {
  aapiKey: "AIzaSyDhYzayWMLzJdZGLwymhY3hfxCl6tw4qtE",
  authDomain: "schedule-bc89e.firebaseapp.com",
  projectId: "schedule-bc89e",
  storageBucket: "schedule-bc89e.firebasestorage.app",
  messagingSenderId: "772996974911",
  appId: "1:772996974911:web:a840bfa3f719c5683bab8a",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache() });

// DOM 元素
const statusEl = document.getElementById('sync-status');
const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const tagSelect = document.getElementById('tag-select');
const dueDateInput = document.getElementById('due-date-input');
const todoListEl = document.getElementById('todo-list');
const notifyBtn = document.getElementById('notify-btn');

let currentUser = null;
let allTodos = [];
let currentFilter = 'all';
let notifiedIds = new Set(); // 避免重複發送通知

// 2. 匿名登入與資料監聽
signInAnonymously(auth).catch(() => statusEl.textContent = "驗證失敗");

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    statusEl.textContent = "已同步";
    listenToTodos(user.uid);
  }
});

function listenToTodos(uid) {
  const todosRef = collection(db, "users", uid, "todos");
  // 依照自訂拖曳順序 order 升冪排列
  const q = query(todosRef, orderBy("order", "asc"));

  onSnapshot(q, (snapshot) => {
    allTodos = [];
    snapshot.forEach((docSnap) => {
      allTodos.push({ id: docSnap.id, ...docSnap.data() });
    });
    renderList();
  });
}

// 3. 渲染清單與篩選
function renderList() {
  todoListEl.innerHTML = '';
  const filtered = currentFilter === 'all' 
    ? allTodos 
    : allTodos.filter(t => t.tag === currentFilter);

  filtered.forEach(todo => {
    todoListEl.appendChild(createTodoElement(todo));
  });
}

// 課堂標籤篩選事件
document.querySelectorAll('.filter-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.tag;
    renderList();
  });
});

// 4. 新增待辦
todoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = todoInput.value.trim();
  if (!text || !currentUser) return;

  const tag = tagSelect.value;
  const dueDate = dueDateInput.value || null;
  todoInput.value = '';
  dueDateInput.value = '';

  // 新項目排在最上方 (取目前最小 order - 1000)
  const minOrder = allTodos.length > 0 ? Math.min(...allTodos.map(t => t.order || 0)) : 0;

  await addDoc(collection(db, "users", currentUser.uid, "todos"), {
    text,
    tag,
    dueDate,
    completed: false,
    order: minOrder - 1000,
    createdAt: serverTimestamp()
  });
});

// 5. 建立單張卡片（包含左滑刪除手勢與行事曆匯出）
function createTodoElement(todo) {
  const wrapper = document.createElement('li');
  wrapper.className = `todo-wrapper ${todo.completed ? 'completed' : ''}`;
  wrapper.dataset.id = todo.id;

  // 紅色刪除背景
  const deleteBg = document.createElement('div');
  deleteBg.className = 'swipe-delete-bg';
  deleteBg.textContent = '放開刪除';

  // 毛玻璃卡片本體
  const card = document.createElement('div');
  card.className = 'todo-card';

  // 打勾圓圈
  const checkBtn = document.createElement('div');
  checkBtn.className = 'check-circle';
  checkBtn.onclick = () => updateDoc(doc(db, "users", currentUser.uid, "todos", todo.id), {
    completed: !todo.completed
  });

  // 文字與標籤區
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

  // 一鍵匯入 Apple 行事曆 (.ics) 按鈕
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

  // 拖曳把手
  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.innerHTML = '≡';

  card.appendChild(checkBtn);
  card.appendChild(content);
  card.appendChild(handle);
  wrapper.appendChild(deleteBg);
  wrapper.appendChild(card);

  // 綁定左滑刪除手勢
  attachSwipeToDelete(card, todo.id);

  return wrapper;
}

// 6. 左滑刪除觸控邏輯
function attachSwipeToDelete(cardEl, todoId) {
  let startX = 0;
  let currentX = 0;
  let isSwiping = false;

  cardEl.addEventListener('touchstart', (e) => {
    // 若按在拖曳把手上則不觸發左滑
    if (e.target.classList.contains('drag-handle')) return;
    startX = e.touches[0].clientX;
    isSwiping = true;
    cardEl.style.transition = 'none';
  }, { passive: true });

  cardEl.addEventListener('touchmove', (e) => {
    if (!isSwiping) return;
    const diffX = e.touches[0].clientX - startX;
    if (diffX < 0) { // 只允許往左滑
      currentX = diffX;
      cardEl.style.transform = `translateX(${currentX}px)`;
    }
  }, { passive: true });

  cardEl.addEventListener('touchend', async () => {
    if (!isSwiping) return;
    isSwiping = false;
    cardEl.style.transition = 'transform 0.2s ease-out';

    // 左滑超過 110px 觸發刪除
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

// 7. 拖曳排序初始化與寫回 Firebase
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

// 8. 生成 .ics 檔案喚起 iOS 原生行事曆
function exportToAppleCalendar(todo) {
  const startDate = todo.dueDate ? new Date(todo.dueDate) : new Date(Date.now() + 3600000);
  const endDate = new Date(startDate.getTime() + 3600000); // 預設時長 1 小時

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
    'TRIGGER:-PT15M', // 提前 15 分鐘提醒
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

// 9. iOS 系統通知授權與定時檢查
notifyBtn.addEventListener('click', async () => {
  if (!('Notification' in window)) {
    alert('請先將此網頁「加入主畫面」後再開啟通知功能');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    notifyBtn.textContent = '🔔 通知已開啟';
    new Notification('通知已啟用', { body: '到期任務將會透過系統橫幅提醒你！' });
  }
});

// 每 30 秒檢查是否有到期任務需要發送通知
setInterval(() => {
  if (Notification.permission !== 'granted') return;
  const now = Date.now();
  allTodos.forEach(todo => {
    if (!todo.completed && todo.dueDate && !notifiedIds.has(todo.id)) {
      const dueTime = new Date(todo.dueDate).getTime();
      // 若已到達設定時間（誤差 1 分鐘內）
      if (now >= dueTime && now - dueTime < 60000) {
        new Notification(`⏰ [${todo.tag}] 任務提醒`, { body: todo.text });
        notifiedIds.add(todo.id);
      }
    }
  });
}, 30000);

// 註冊 Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}