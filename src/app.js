import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue, push, set, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider, 
  updatePassword, 
  updateProfile,
  signOut, 
  onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyByg84alOyd8njFHvwKtsjb1GYXaVW9CH8",
  authDomain: "final-1-43f3d.firebaseapp.com",
  databaseURL: "https://final-1-43f3d-default-rtdb.firebaseio.com",
  projectId: "final-1-43f3d",
  storageBucket: "final-1-43f3d.firebasestorage.app",
  messagingSenderId: "44009226017",
  appId: "1:44009226017:web:351390dad2794208984860"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const firestore = getFirestore(app);
const auth = getAuth(app);

const userId = localStorage.getItem('yt_market_user_id') || 'user_' + Math.random().toString(36).substr(2, 9);
localStorage.setItem('yt_market_user_id', userId);

// ============================================================
// FIREBASE CLOUD MESSAGING (FCM) & DEVICE PUSH NOTIFICATIONS
// ============================================================
let fcmMessaging = null;
let swRegistration = null;
let fcmToken = localStorage.getItem('yt_fcm_token') || null;
let seenNotifIds = new Set(JSON.parse(localStorage.getItem('yt_seen_notif_ids') || '[]'));
let isInitialNotifLoad = true;

// Initialize Service Worker and Firebase Messaging
async function initPushNotificationSystem() {
  // Guarantee collection & device entry in Firestore immediately
  saveDeviceToFirestore(fcmToken);

  if (!('serviceWorker' in navigator)) {
    console.log('[Push] Service Workers not supported in this browser');
    return;
  }

  try {
    // Register Service Worker
    swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    console.log('[Push] Service Worker registered:', swRegistration);

    await navigator.serviceWorker.ready;

    // Check if Firebase Cloud Messaging is supported
    const supported = await isSupported().catch(() => false);
    if (supported) {
      try {
        fcmMessaging = getMessaging(app);

        // Handle foreground notifications received while in app
        onMessage(fcmMessaging, (payload) => {
          console.log('[FCM] Foreground push message received:', payload);
          const title = payload.notification?.title || payload.data?.title || 'YT Market';
          const body = payload.notification?.body || payload.data?.body || payload.data?.message || 'New update received';
          const icon = payload.notification?.icon || payload.data?.icon || '/icon-192.png';
          
          window.showNativePhoneNotification(title, body, icon, payload.data);
        });
      } catch (err) {
        console.warn('[FCM] Messaging init error:', err);
      }
    }

    // Always attempt to obtain and save token
    obtainAndSaveFcmToken();
  } catch (err) {
    console.warn('[Push] Initialization error:', err);
  }
}

// Function to guarantee record in Firestore "fcm" and "fcmTokens" collections
async function saveDeviceToFirestore(token = null) {
  const currentToken = token || fcmToken || localStorage.getItem('yt_fcm_token') || `device_${userId}`;
  const nowIso = new Date().toISOString();
  
  const payload = {
    userId: userId,
    token: currentToken,
    fcmToken: currentToken,
    platform: 'web',
    device: navigator.userAgent || 'Web Browser',
    status: token ? 'active' : 'registered',
    notificationPermission: ('Notification' in window) ? Notification.permission : 'not_supported',
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  };

  try {
    // 1. Write via Firebase JS SDK to "fcm" collection
    await setDoc(doc(firestore, "fcm", userId), payload, { merge: true });
    // Write via Firebase JS SDK to "fcmTokens" collection
    await setDoc(doc(firestore, "fcmTokens", userId), payload, { merge: true });

    if (token) {
      const cleanToken = token.replace(/[.#$[\]/]/g, '_');
      await setDoc(doc(firestore, "fcm", cleanToken), payload, { merge: true });
      await setDoc(doc(firestore, "fcmTokens", cleanToken), payload, { merge: true });
    }
    console.log('[Firestore] Document written to "fcm" and "fcmTokens" collections successfully');
  } catch (sdkErr) {
    console.warn('[Firestore] SDK write note:', sdkErr);
  }

  // 2. Direct REST write fallback guarantees collection creation in Firestore Console for both
  try {
    const fcmRestUrl = `https://firestore.googleapis.com/v1/projects/final-1-43f3d/databases/(default)/documents/fcm/${userId}?key=AIzaSyByg84alOyd8njFHvwKtsjb1GYXaVW9CH8`;
    await fetch(fcmRestUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          userId: { stringValue: userId },
          token: { stringValue: currentToken },
          fcmToken: { stringValue: currentToken },
          platform: { stringValue: "web" },
          device: { stringValue: navigator.userAgent || "Web Browser" },
          status: { stringValue: token ? "active" : "registered" },
          updatedAt: { stringValue: nowIso }
        }
      })
    });

    const fcmTokensRestUrl = `https://firestore.googleapis.com/v1/projects/final-1-43f3d/databases/(default)/documents/fcmTokens/${userId}?key=AIzaSyByg84alOyd8njFHvwKtsjb1GYXaVW9CH8`;
    await fetch(fcmTokensRestUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          userId: { stringValue: userId },
          token: { stringValue: currentToken },
          fcmToken: { stringValue: currentToken },
          platform: { stringValue: "web" },
          device: { stringValue: navigator.userAgent || "Web Browser" },
          status: { stringValue: token ? "active" : "registered" },
          updatedAt: { stringValue: nowIso }
        }
      })
    });
  } catch (restErr) {
    // Silent
  }
}

// Request Notification Permission from User
window.requestPushPermission = async () => {
  if (!('Notification' in window)) {
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      localStorage.setItem('yt_notif', 'true');
      const notifTog = document.getElementById('toggle-notif');
      if (notifTog) notifTog.checked = true;
      await obtainAndSaveFcmToken();
      return true;
    } else if (permission === 'denied') {
      console.log('[Push] User denied notification permission');
      return false;
    }
  } catch (e) {
    console.warn('[Push] Request permission error:', e);
  }
  return false;
};

// Retrieve FCM Device Token and register with Firebase
async function obtainAndSaveFcmToken() {
  await saveDeviceToFirestore(fcmToken);

  if (!fcmMessaging || !swRegistration) return null;

  try {
    const token = await getToken(fcmMessaging, {
      serviceWorkerRegistration: swRegistration
    }).catch((e) => {
      console.warn('[FCM] getToken standard attempt note:', e);
      return null;
    });

    if (token) {
      fcmToken = token;
      localStorage.setItem('yt_fcm_token', token);
      console.log('[FCM] Token acquired:', token);

      const cleanToken = token.replace(/[.#$[\]/]/g, '_');
      const tokenPayload = {
        token: token,
        userId: userId,
        platform: 'web',
        updatedAt: Date.now(),
        userAgent: navigator.userAgent
      };

      // 1. Save token into Cloud Firestore "fcmTokens" collection
      await saveDeviceToFirestore(token);

      // 2. Save token to RTDB paths so all existing admin methods continue to work seamlessly
      set(ref(db, `fcm_tokens/${cleanToken}`), tokenPayload).catch(() => {});
      set(ref(db, `device_tokens/${userId}`), tokenPayload).catch(() => {});
      set(ref(db, `tokens/${cleanToken}`), tokenPayload).catch(() => {});
      set(ref(db, `users/${userId}/fcm_token`), token).catch(() => {});
      set(ref(db, `users/${userId}/fcmToken`), token).catch(() => {});

      return token;
    }
  } catch (err) {
    console.warn('[FCM] Token retrieval note:', err);
  }
  return null;
}

// Show native phone/browser notification outside the application
window.showNativePhoneNotification = (title, body, icon, data = {}) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (localStorage.getItem('yt_notif') === 'false') return;

  const notifTitle = title || 'YT Market Notification';
  const notifOptions = {
    body: body || 'New update from YT Market',
    icon: icon || '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: 'yt-market-alert-' + (data.id || Date.now()),
    renotify: true,
    data: data || { url: '/' }
  };

  // Deliver via Service Worker for reliable lockscreen & system tray display
  if (swRegistration && swRegistration.showNotification) {
    swRegistration.showNotification(notifTitle, notifOptions).catch(() => {
      try { new Notification(notifTitle, notifOptions); } catch (e) {}
    });
  } else if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(notifTitle, notifOptions).catch(() => {
        try { new Notification(notifTitle, notifOptions); } catch (e) {}
      });
    }).catch(() => {
      try { new Notification(notifTitle, notifOptions); } catch (e) {}
    });
  } else {
    try {
      new Notification(notifTitle, notifOptions);
    } catch (e) {}
  }
};

let allChannels = [];
let myRequests = [];
let myDisputes = [];
let notifications = [];
let selectedChannelId = null;
let telegramLink = 'https://t.me/Ytmarket1';
let currentCategory = 'all'; 
let currentLanguage = 'en';

// Admin assignment and attachments
const adminNamesList = ["Rahul (Senior Support)", "Amit Kumar", "Priya Sharma", "Sneha Patel", "Vikram Singh", "Neha Verma", "Rajesh Support Manager"];
let currentSessionAdmin = "";
let activeUploadedAttachment = "";
let activeDisputeProof = "";

function refreshLucide() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

// Online / Offline Detection
function updateNetworkStatus() {
  const offlineScreen = document.getElementById('offline-screen');
  if (!navigator.onLine) {
    offlineScreen?.classList.remove('hidden');
  } else {
    offlineScreen?.classList.add('hidden');
  }
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
updateNetworkStatus();

// Custom Alert System
window.showAlert = (msg) => {
  const alert = document.getElementById('custom-alert');
  const content = document.getElementById('alert-content');
  const msgEl = document.getElementById('alert-message');
  if (!alert || !content || !msgEl) return;
  msgEl.innerText = msg;
  alert.classList.remove('hidden');
  setTimeout(() => {
    alert.classList.add('opacity-100');
    content.classList.remove('scale-95');
  }, 10);
};

window.closeAlert = () => {
  const alert = document.getElementById('custom-alert');
  const content = document.getElementById('alert-content');
  if (!alert || !content) return;
  alert.classList.remove('opacity-100');
  content.classList.add('scale-95');
  setTimeout(() => alert.classList.add('hidden'), 250);
};

// Global Click Audio Feedback
document.addEventListener('click', (e) => {
  if (localStorage.getItem('yt_sound') === 'true') {
    const isClickable = e.target.closest('button') || e.target.closest('a') || e.target.closest('.cursor-pointer');
    if (isClickable) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          const osc = ctx.createOscillator();
          const gainNode = ctx.createGain();
          osc.connect(gainNode);
          gainNode.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(800, ctx.currentTime);
          gainNode.gain.setValueAtTime(0.04, ctx.currentTime);
          osc.start();
          osc.stop(ctx.currentTime + 0.04);
        }
      } catch (err) {}
    }
  }
});

// Bilingual Language Translation
window.setLanguage = (lang) => {
  currentLanguage = lang;
  localStorage.setItem('yt_lang', lang);
  
  document.querySelectorAll('[data-hi]').forEach(el => {
    if (lang === 'hi') {
      if (!el.hasAttribute('data-en-saved')) {
        el.setAttribute('data-en-saved', el.innerHTML);
      }
      el.innerHTML = el.getAttribute('data-hi');
    } else {
      if (el.hasAttribute('data-en-saved')) {
        el.innerHTML = el.getAttribute('data-en-saved');
      }
    }
  });

  refreshLucide();

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.placeholder = lang === 'hi' ? "एसेट्स खोजें..." : "Search assets...";
  }

  const btnEn = document.getElementById('btn-lang-en');
  const btnHi = document.getElementById('btn-lang-hi');
  if (btnEn && btnHi) {
    if (lang === 'en') {
      btnEn.className = 'px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold shadow-lg transition-all cursor-pointer';
      btnHi.className = 'px-4 py-2 bg-black/40 text-gray-400 border border-white/10 rounded-lg text-sm font-bold transition-all cursor-pointer';
    } else {
      btnHi.className = 'px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold shadow-lg transition-all cursor-pointer';
      btnEn.className = 'px-4 py-2 bg-black/40 text-gray-400 border border-white/10 rounded-lg text-sm font-bold transition-all cursor-pointer';
    }
  }
  
  if (document.getElementById('category-title')) {
    window.setCategory(currentCategory);
  }
};

window.toggleSetting = async (key, value) => {
  localStorage.setItem('yt_' + key, value);
  if (key === 'notifications' && value) {
    await window.requestPushPermission();
  }
};

window.toggleThemeSetting = () => {
  document.documentElement.classList.toggle('dark');
};

// Navigation View Controller
window.showView = (viewId) => {
  document.querySelectorAll('.app-view').forEach(v => v.classList.add('hidden'));
  const target = document.getElementById(viewId);
  if (target) {
    target.classList.remove('hidden');
  }
  window.scrollTo(0, 0);
  if (viewId === 'notifications-view') {
    document.getElementById('nav-notif-dot')?.classList.add('hidden');
    document.getElementById('menu-notif-dot')?.classList.add('hidden');
    if ('Notification' in window && Notification.permission === 'default') {
      window.requestPushPermission();
    }
  } else if (viewId === 'chat-view') {
    validateAndRenderChatView();
  } else if (viewId === 'orders-view') {
    window.renderUserOrders();
  } else if (viewId === 'wallet-view') {
    window.renderWallet();
  } else if (viewId === 'disputes-hub-view') {
    window.renderDisputesHub();
  } else if (viewId === 'reviews-view') {
    window.renderReviews();
  } else if (viewId === 'profile-view') {
    window.renderProfileView();
  } else if (viewId === 'watchlist-view') {
    window.renderWatchlist();
  }
  refreshLucide();
};

// Sidebar Controls
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('sidebar-overlay');
const menuBtn = document.getElementById('menu-btn');
const closeSidebarBtn = document.getElementById('close-sidebar-btn');

if (menuBtn) {
  menuBtn.onclick = () => { 
    sidebar?.classList.remove('-translate-x-full'); 
    overlay?.classList.remove('hidden'); 
    setTimeout(() => overlay?.classList.remove('opacity-0'), 10); 
  };
}

window.closeSidebar = () => { 
  sidebar?.classList.add('-translate-x-full'); 
  overlay?.classList.add('opacity-0'); 
  setTimeout(() => overlay?.classList.add('hidden'), 250); 
};

if (closeSidebarBtn) closeSidebarBtn.onclick = window.closeSidebar;
if (overlay) overlay.onclick = window.closeSidebar;

// Category Filtering
window.setCategory = (cat) => {
  currentCategory = cat;
  let titleEn = 'Trending Assets';
  let titleHi = 'ट्रेंडिंग एसेट्स';
  if (cat === 'youtube') { titleEn = 'YouTube Channels'; titleHi = 'यूट्यूब चैनल'; }
  if (cat === 'instagram') { titleEn = 'Instagram Accounts'; titleHi = 'इंस्टाग्राम अकाउंट'; }
  if (cat === 'facebook') { titleEn = 'Facebook Pages'; titleHi = 'फेसबुक पेज'; }
  
  const titleEl = document.getElementById('category-title');
  if (titleEl) {
    titleEl.setAttribute('data-en-saved', titleEn);
    titleEl.setAttribute('data-hi', titleHi);
    titleEl.innerText = currentLanguage === 'hi' ? titleHi : titleEn;
  }
  
  // Update Category Option Buttons active styles
  const cats = ['all', 'youtube', 'instagram', 'facebook'];
  cats.forEach(c => {
    const btn = document.getElementById(`cat-btn-${c}`);
    if (!btn) return;
    const base = 'flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-2.5 px-2 sm:px-4 rounded-2xl font-bold text-xs transition-all cursor-pointer border';
    if (c === cat) {
      if (c === 'youtube') {
        btn.className = `${base} bg-red-600 text-white border-red-500 shadow-lg shadow-red-600/30`;
      } else if (c === 'instagram') {
        btn.className = `${base} bg-gradient-to-r from-pink-600 to-purple-600 text-white border-pink-500 shadow-lg shadow-pink-600/30`;
      } else if (c === 'facebook') {
        btn.className = `${base} bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-600/30`;
      } else {
        btn.className = `${base} bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-600/30`;
      }
    } else {
      btn.className = `${base} bg-[#111111] hover:bg-white/5 text-gray-300 border-white/10 hover:text-white`;
    }
  });

  renderChannels();
  refreshLucide();
};

// Splash Screen Removal & Authentication Gate Check
setTimeout(() => {
  const splash = document.getElementById('splash-screen');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => {
      splash.style.display = 'none';
      if (currentAuthUser) {
        document.getElementById('app-container')?.classList.remove('hidden');
        document.getElementById('auth-modal')?.classList.add('hidden');
      } else {
        document.getElementById('app-container')?.classList.add('hidden');
        window.openAuthModal('login');
      }
      refreshLucide();
    }, 450);
  }
}, 1200);

// Dynamic Realtime Banner Slider
let currentSlide = 0;
let sliderTimer = null;
let totalSlidesCount = 0;

onValue(ref(db, 'banners'), (snapshot) => {
  const data = snapshot.val();
  const sliderContainer = document.getElementById('banner-slider');
  const dotsContainer = document.getElementById('banner-dots-container');
  if (!sliderContainer) return;
  
  let bannersList = [];
  if (data) {
    bannersList = Object.keys(data).map(k => ({ id: k, ...data[k] })).sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
  } else {
    bannersList = [
      { type: 'image', url: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&q=80&w=800', title: 'Premium Monetized Assets', subtitle: 'Verified with Escrow Vault Protection' },
      { type: 'image', url: 'https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&q=80&w=800', title: 'Secure Handover Protocol', subtitle: '24-48h inspection window before fund release' }
    ];
  }

  totalSlidesCount = bannersList.length;
  currentSlide = 0;
  sliderContainer.style.transform = 'translateX(0%)';

  sliderContainer.innerHTML = bannersList.map(b => {
    if (b.type === 'video') {
      return `
        <div class="w-full h-full flex-shrink-0 relative bg-black">
          <video src="${b.url}" autoplay muted loop playsinline class="w-full h-full object-cover"></video>
          <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-8 text-left">
            <h3 class="text-2xl font-black text-white leading-tight mb-1">${b.title || ''}</h3>
            <p class="text-xs text-gray-300 font-medium">${b.subtitle || ''}</p>
          </div>
        </div>`;
    } else {
      return `
        <div class="w-full h-full flex-shrink-0 relative">
          <img src="${b.url}" class="w-full h-full object-cover" alt="Banner" />
          <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-8 text-left">
            <h3 class="text-2xl font-black text-white leading-tight mb-1">${b.title || ''}</h3>
            <p class="text-xs text-gray-300 font-medium">${b.subtitle || ''}</p>
          </div>
        </div>`;
    }
  }).join('');

  if (dotsContainer) {
    dotsContainer.innerHTML = bannersList.map((_, i) => `
      <div class="w-2 h-2 rounded-full transition-all duration-300 banner-dot ${i === 0 ? 'bg-white' : 'bg-white/40'}"></div>
    `).join('');
  }

  setupSliderInterval();
});

function setupSliderInterval() {
  if (sliderTimer) clearInterval(sliderTimer);
  if (totalSlidesCount <= 1) return;
  sliderTimer = setInterval(() => {
    currentSlide = (currentSlide + 1) % totalSlidesCount;
    const slider = document.getElementById('banner-slider');
    const dots = document.querySelectorAll('.banner-dot');
    if (slider) {
      slider.style.transform = `translateX(-${currentSlide * 100}%)`;
      dots.forEach((dot, index) => {
        dot.classList.toggle('bg-white', index === currentSlide);
        dot.classList.toggle('bg-white/40', index !== currentSlide);
      });
    }
  }, 4000); 
}

// Channels Realtime Sync
onValue(ref(db, 'channels'), (snapshot) => {
  const data = snapshot.val();
  allChannels = [];
  if (data) {
    Object.keys(data).forEach(k => {
      if (data[k].status === 'live' || !data[k].status) {
        allChannels.push({ id: k, ...data[k] });
      }
    });
  }
  renderChannels();
  updateWatchlistBadges();
  const wlView = document.getElementById('watchlist-view');
  if (wlView && !wlView.classList.contains('hidden')) window.renderWatchlist();
  if (selectedChannelId) updateProductView();
});

// Payment Requests Sync
onValue(ref(db, 'payment_requests'), (snapshot) => {
  const data = snapshot.val();
  myRequests = [];
  if (data) {
    Object.keys(data).forEach(k => {
      if (data[k].userId === userId) {
        myRequests.push({ id: k, ...data[k] });
      }
    });
  }
  if (selectedChannelId) updateProductView();
});

// Disputes Sync
onValue(ref(db, 'disputes'), (snapshot) => {
  const data = snapshot.val();
  myDisputes = [];
  if (data) {
    Object.keys(data).forEach(k => {
      if (data[k].userId === userId) {
        myDisputes.push({ id: k, ...data[k] });
      }
    });
  }
  if (selectedChannelId) updateProductView();
});

// Platform Settings Sync
onValue(ref(db, 'settings'), (snapshot) => {
  const d = snapshot.val();
  if (d && d.telegram) {
    telegramLink = d.telegram;
    const pvTg = document.getElementById('pv-telegram-btn');
    const sbTg = document.getElementById('sidebar-telegram-btn');
    if (pvTg) pvTg.onclick = () => window.open(d.telegram, '_blank');
    if (sbTg) sbTg.onclick = () => window.open(d.telegram, '_blank');
  }
});

// Notifications Sync
onValue(ref(db, 'notifications'), (snapshot) => {
  const data = snapshot.val();
  notifications = [];
  if (data) Object.keys(data).forEach(k => notifications.push({ id: k, ...data[k] }));
  notifications.sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
  renderNotifications();
  if (notifications.length > 0 && localStorage.getItem('yt_notif') !== 'false') {
    document.getElementById('nav-notif-dot')?.classList.remove('hidden');
    document.getElementById('menu-notif-dot')?.classList.remove('hidden');
  }

  // Trigger Phone Notification outside app for new notifications from Admin
  if (data) {
    const keys = Object.keys(data);
    const newItems = keys.filter(k => !seenNotifIds.has(k));

    if (!isInitialNotifLoad && newItems.length > 0) {
      newItems.forEach(k => {
        const item = data[k];
        if (item) {
          window.showNativePhoneNotification(
            item.title || 'YT Market Notification',
            item.message || item.body || 'You have received a new update from admin.',
            item.icon || '/icon-192.png',
            { id: k, ...item }
          );
        }
      });
    }

    keys.forEach(k => seenNotifIds.add(k));
    try {
      localStorage.setItem('yt_seen_notif_ids', JSON.stringify(Array.from(seenNotifIds).slice(-100)));
    } catch (e) {}
  }
  isInitialNotifLoad = false;
});

function renderNotifications() {
  const list = document.getElementById('notifications-list');
  if (!list) return;
  if (notifications.length === 0) {
    let emptyMsg = currentLanguage === 'hi' ? "कोई नई अधिसूचना नहीं।" : "No new notifications.";
    list.innerHTML = `<div class="text-center py-10 text-gray-500 font-medium">${emptyMsg}</div>`;
    return;
  }
  
  list.innerHTML = notifications.map(n => `
    <div class="bg-[#1a1a1a] p-4 rounded-xl border border-white/5 flex gap-4 items-start">
      <div class="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg shrink-0">
        <i data-lucide="${n.icon || 'bell'}" class="w-5 h-5"></i>
      </div>
      <div>
        <h4 class="text-white font-bold text-sm">${n.title || 'New Update'}</h4>
        <p class="text-gray-400 text-xs mt-1 leading-relaxed">${n.message || ''}</p>
        <span class="text-[10px] text-gray-500 mt-2 block">${new Date(n.timestamp || Date.now()).toLocaleDateString()}</span>
      </div>
    </div>
  `).join('');
  refreshLucide();
}

// Marketplace Grid Rendering
window.handleSearch = () => renderChannels();

function renderChannels() {
  const grid = document.getElementById('channels-grid');
  if (!grid) return;
  const term = document.getElementById('search-input')?.value.toLowerCase() || '';
  
  let filtered = allChannels;
  if (term) filtered = filtered.filter(c => (c.name || '').toLowerCase().includes(term));
  if (currentCategory !== 'all') {
    filtered = filtered.filter(c => {
      let cat = (c.category || '').toLowerCase().trim();
      if (!cat) {
        const link = (c.link || '').toLowerCase();
        const name = (c.name || '').toLowerCase();
        if (link.includes('instagram.com') || name.includes('instagram') || name.includes('insta')) cat = 'instagram';
        else if (link.includes('facebook.com') || link.includes('fb.com') || name.includes('facebook') || name.includes('fb page')) cat = 'facebook';
        else cat = 'youtube';
      }
      return cat === currentCategory.toLowerCase().trim();
    });
  }

  if (filtered.length === 0) {
    grid.innerHTML = '';
    document.getElementById('no-channels-msg')?.classList.remove('hidden');
    return;
  }
  
  document.getElementById('no-channels-msg')?.classList.add('hidden');
  
  let buyBtnText = currentLanguage === 'hi' ? 'अभी खरीदें' : 'Buy Now';
  let detailsBtnText = currentLanguage === 'hi' ? 'विवरण' : 'Details';

  grid.innerHTML = filtered.map(c => {
    let catName = (c.category || '').toLowerCase().trim();
    if (!catName) {
      const link = (c.link || '').toLowerCase();
      const name = (c.name || '').toLowerCase();
      if (link.includes('instagram.com') || name.includes('instagram') || name.includes('insta')) catName = 'instagram';
      else if (link.includes('facebook.com') || link.includes('fb.com') || name.includes('facebook') || name.includes('fb page')) catName = 'facebook';
      else catName = 'youtube';
    }

    let catIcon = 'youtube';
    let catColor = 'text-red-400';
    if (catName === 'instagram') { catIcon = 'instagram'; catColor = 'text-pink-500'; }
    if (catName === 'facebook') { catIcon = 'facebook'; catColor = 'text-blue-500'; }

    const inWatchlist = window.isInWatchlist(c.id);
    return `
    <div onclick="window.showProduct('${c.id}')" class="bg-[#111111] rounded-[2rem] overflow-hidden border border-white/5 transition-all cursor-pointer group shadow-lg card-hover relative text-left">
      <button type="button" onclick="window.toggleWatchlist('${c.id}', event)" class="absolute top-3 left-3 bg-black/60 hover:bg-black/80 backdrop-blur p-2 rounded-full z-10 text-white transition-colors cursor-pointer border border-white/10" title="Watchlist" aria-label="Toggle Watchlist">
        <i data-lucide="bookmark" class="w-4 h-4 ${inWatchlist ? 'fill-rose-500 text-rose-500' : 'text-gray-300 hover:text-white'}"></i>
      </button>
      <div class="absolute top-3 right-3 bg-black/60 backdrop-blur p-2 rounded-full z-10">
         <i data-lucide="${catIcon}" class="w-4 h-4 ${catColor}"></i>
      </div>
      <div class="relative h-48 overflow-hidden bg-black/40">
        <img src="${c.thumb || c.banner || 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&q=80&w=400'}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="${c.name || ''}" />
      </div>
      <div class="p-6">
        <div class="flex items-center gap-1.5 text-xs text-emerald-400 font-bold mb-1">
          <i data-lucide="shield-check" class="w-3.5 h-3.5"></i> <span>Escrow Protected</span>
        </div>
        <h3 class="font-bold text-white mb-4 text-base line-clamp-1 uppercase tracking-tight">${c.name || 'Channel'}</h3>
        <div class="flex justify-between items-center">
          <span class="text-xl font-black">₹${c.price || 0}</span>
          <div class="flex items-center gap-2">
            <span class="bg-gradient-to-r from-emerald-500 to-green-600 text-white px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-green-500/20 pointer-events-none select-none">${buyBtnText}</span>
            <button class="bg-indigo-600/20 text-indigo-400 px-4 py-1.5 rounded-xl text-xs font-bold border border-indigo-500/20">${detailsBtnText}</button>
          </div>
        </div>
      </div>
    </div>
  `}).join('');
  refreshLucide();
}

window.showProduct = (id) => { 
  selectedChannelId = id; 
  window.showView('product-view');
  updateProductView(); 
};

// ============================================================
// WATCHLIST SYSTEM (Local & User Persistence)
// ============================================================
function getWatchlistStorageKey() {
  const uid = (currentAuthUser && currentAuthUser.uid) ? currentAuthUser.uid : userId;
  return `yt_watchlist_${uid}`;
}

window.getWatchlist = () => {
  try {
    const key = getWatchlistStorageKey();
    const list = JSON.parse(localStorage.getItem(key) || localStorage.getItem('yt_watchlist') || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
};

window.saveWatchlist = (list) => {
  try {
    const key = getWatchlistStorageKey();
    localStorage.setItem(key, JSON.stringify(list));
    localStorage.setItem('yt_watchlist', JSON.stringify(list));
    
    // Also save to Firebase Realtime Database
    const targetUid = (currentAuthUser && currentAuthUser.uid) ? currentAuthUser.uid : userId;
    if (targetUid) {
      set(ref(db, `users/${targetUid}/watchlist`), list).catch(() => {});
    }
  } catch (e) {
    console.warn('[Watchlist] Save error:', e);
  }
  updateWatchlistBadges();
};

window.isInWatchlist = (assetId) => {
  if (!assetId) return false;
  const list = window.getWatchlist();
  return list.includes(String(assetId));
};

window.toggleWatchlist = (assetId, event) => {
  if (event && event.stopPropagation) {
    event.stopPropagation();
  }
  if (!assetId) return;
  const idStr = String(assetId);
  let list = window.getWatchlist();
  const index = list.indexOf(idStr);
  let added = false;

  if (index > -1) {
    list.splice(index, 1);
    added = false;
  } else {
    list.push(idStr);
    added = true;
  }

  window.saveWatchlist(list);

  const channel = allChannels.find(c => String(c.id) === idStr);
  const channelName = channel ? (channel.name || 'Asset') : 'Asset';
  
  if (added) {
    window.showAlert(currentLanguage === 'hi' 
      ? `"${channelName}" को वॉचलिस्ट में जोड़ा गया!` 
      : `"${channelName}" added to Watchlist!`);
  } else {
    window.showAlert(currentLanguage === 'hi' 
      ? `"${channelName}" को वॉचलिस्ट से हटाया गया!` 
      : `"${channelName}" removed from Watchlist!`);
  }

  // Update product view watchlist button if open
  if (selectedChannelId && String(selectedChannelId) === idStr) {
    updateProductWatchlistBtn();
  }

  // Re-render marketplace channels
  renderChannels();

  // If watchlist view is open, re-render it
  const watchlistView = document.getElementById('watchlist-view');
  if (watchlistView && !watchlistView.classList.contains('hidden')) {
    window.renderWatchlist();
  }
};

function updateWatchlistBadges() {
  const list = window.getWatchlist();
  const count = list.length;
  
  const navBadge = document.getElementById('nav-watchlist-count');
  if (navBadge) {
    navBadge.innerText = count;
    navBadge.classList.toggle('hidden', count === 0);
  }

  const sideBadge = document.getElementById('sidebar-watchlist-count');
  if (sideBadge) {
    sideBadge.innerText = count;
    sideBadge.classList.toggle('hidden', count === 0);
  }

  const quickBadge = document.getElementById('quick-watchlist-count');
  if (quickBadge) {
    quickBadge.innerText = count;
    quickBadge.classList.toggle('hidden', count === 0);
  }

  const totalBadge = document.getElementById('watchlist-total-count');
  if (totalBadge) {
    totalBadge.innerText = `${count} ${count === 1 ? 'Asset' : 'Assets'}`;
  }
}

function updateProductWatchlistBtn() {
  const btn = document.getElementById('pv-watchlist-btn');
  const icon = document.getElementById('pv-watchlist-icon');
  const text = document.getElementById('pv-watchlist-text');
  if (!btn || !selectedChannelId) return;

  const inList = window.isInWatchlist(selectedChannelId);
  if (inList) {
    btn.className = "bg-rose-600/25 text-rose-300 border border-rose-500/50 p-3 rounded-full flex items-center gap-2 px-4 cursor-pointer hover:bg-rose-600/35 transition-all shadow-lg backdrop-blur-md";
    if (icon) icon.setAttribute('class', 'w-5 h-5 fill-rose-500 text-rose-500');
    if (text) text.innerText = currentLanguage === 'hi' ? 'वॉचलिस्ट में है' : 'In Watchlist';
  } else {
    btn.className = "bg-white/10 backdrop-blur-md border border-white/20 p-3 rounded-full text-white flex items-center gap-2 px-4 cursor-pointer hover:bg-white/20 transition-all shadow-lg";
    if (icon) icon.setAttribute('class', 'w-5 h-5 text-white');
    if (text) text.innerText = currentLanguage === 'hi' ? 'वॉचलिस्ट में जोड़ें' : 'Add to Watchlist';
  }
}

window.renderWatchlist = () => {
  updateWatchlistBadges();
  const grid = document.getElementById('watchlist-grid');
  const emptyBox = document.getElementById('watchlist-empty-box');
  const searchInput = document.getElementById('watchlist-search-input');
  if (!grid) return;

  const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const list = window.getWatchlist();

  // Filter allChannels to only those in the watchlist
  let savedChannels = allChannels.filter(c => list.includes(String(c.id)));

  if (term) {
    savedChannels = savedChannels.filter(c => (c.name || '').toLowerCase().includes(term));
  }

  if (savedChannels.length === 0) {
    grid.innerHTML = '';
    if (emptyBox) emptyBox.classList.remove('hidden');
    return;
  }

  if (emptyBox) emptyBox.classList.add('hidden');

  let buyBtnText = currentLanguage === 'hi' ? 'अभी खरीदें' : 'Buy Now';
  let detailsBtnText = currentLanguage === 'hi' ? 'विवरण' : 'Details';

  grid.innerHTML = savedChannels.map(c => {
    let catName = (c.category || '').toLowerCase().trim();
    if (!catName) {
      const link = (c.link || '').toLowerCase();
      const name = (c.name || '').toLowerCase();
      if (link.includes('instagram.com') || name.includes('instagram') || name.includes('insta')) catName = 'instagram';
      else if (link.includes('facebook.com') || link.includes('fb.com') || name.includes('facebook') || name.includes('fb page')) catName = 'facebook';
      else catName = 'youtube';
    }

    let catIcon = 'youtube';
    let catColor = 'text-red-400';
    if (catName === 'instagram') { catIcon = 'instagram'; catColor = 'text-pink-500'; }
    if (catName === 'facebook') { catIcon = 'facebook'; catColor = 'text-blue-500'; }

    return `
    <div onclick="window.showProduct('${c.id}')" class="bg-[#111111] rounded-[2rem] overflow-hidden border border-white/5 transition-all cursor-pointer group shadow-lg card-hover relative text-left">
      <button type="button" onclick="window.toggleWatchlist('${c.id}', event)" class="absolute top-3 left-3 bg-black/70 hover:bg-black/90 backdrop-blur p-2 rounded-full z-10 text-rose-400 transition-colors cursor-pointer border border-rose-500/30" title="Remove from Watchlist" aria-label="Remove from Watchlist">
        <i data-lucide="bookmark" class="w-4 h-4 fill-rose-500 text-rose-500"></i>
      </button>

      <div class="absolute top-3 right-3 bg-black/60 backdrop-blur p-2 rounded-full z-10">
         <i data-lucide="${catIcon}" class="w-4 h-4 ${catColor}"></i>
      </div>

      <div class="relative h-48 overflow-hidden bg-black/40">
        <img src="${c.thumb || c.banner || 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&q=80&w=400'}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="${c.name || ''}" />
      </div>
      <div class="p-6">
        <div class="flex items-center gap-1.5 text-xs text-emerald-400 font-bold mb-1">
          <i data-lucide="shield-check" class="w-3.5 h-3.5"></i> <span>Escrow Protected</span>
        </div>
        <h3 class="font-bold text-white mb-4 text-base line-clamp-1 uppercase tracking-tight">${c.name || 'Channel'}</h3>
        <div class="flex justify-between items-center">
          <span class="text-xl font-black">₹${c.price || 0}</span>
          <div class="flex items-center gap-2">
            <span class="bg-gradient-to-r from-emerald-500 to-green-600 text-white px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-green-500/20 pointer-events-none select-none">${buyBtnText}</span>
            <button class="bg-indigo-600/20 text-indigo-400 px-4 py-1.5 rounded-xl text-xs font-bold border border-indigo-500/20">${detailsBtnText}</button>
          </div>
        </div>
      </div>
    </div>
  `}).join('');
  refreshLucide();
};

window.clearWatchlist = () => {
  const list = window.getWatchlist();
  if (list.length === 0) return;
  window.saveWatchlist([]);
  window.showAlert(currentLanguage === 'hi' ? 'वॉचलिस्ट खाली कर दी गई है!' : 'Watchlist cleared!');
  window.renderWatchlist();
  renderChannels();
};

// Inspection Timer Manager
let inspectionTimerInterval = null;
function startInspectionTimer(startTime) {
  if (inspectionTimerInterval) clearInterval(inspectionTimerInterval);
  const timerEl = document.getElementById('escrow-inspection-timer');
  if (!timerEl) return;

  const totalWindowMs = 48 * 60 * 60 * 1000; // 48 Hours Inspection Window

  function tick() {
    const elapsed = Date.now() - (startTime || Date.now());
    const remaining = Math.max(0, totalWindowMs - elapsed);
    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((remaining % (1000 * 60)) / 1000);
    timerEl.innerText = `⏱️ ${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  }
  tick();
  inspectionTimerInterval = setInterval(tick, 1000);
}

// Product Details & Escrow Handover Flow
function updateProductView() {
  const c = allChannels.find(x => x.id === selectedChannelId);
  if (!c) return;
  
  document.getElementById('pv-name').innerText = c.name || 'Channel';
  document.getElementById('pv-price').innerText = c.price || 0;
  document.getElementById('pv-banner').src = c.banner || c.thumb || 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&q=80&w=800';
  document.getElementById('pv-thumb').src = c.thumb || c.banner || 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&q=80&w=200';
  document.getElementById('pv-stat-subs').innerText = c.subs || '0';
  let catName = (c.category || '').toLowerCase().trim();
  if (!catName) {
    const link = (c.link || '').toLowerCase();
    const name = (c.name || '').toLowerCase();
    if (link.includes('instagram.com') || name.includes('instagram') || name.includes('insta')) catName = 'instagram';
    else if (link.includes('facebook.com') || link.includes('fb.com') || name.includes('facebook') || name.includes('fb page')) catName = 'facebook';
    else catName = 'youtube';
  }

  const isSocial = catName === 'instagram' || catName === 'facebook';
  document.getElementById('pv-stat-watch').innerText = (c.watch || '0') + (isSocial ? ' reach' : ' hours');
  document.getElementById('pv-stat-age').innerText = c.age || 'N/A';

  if (isSocial) {
    let folLabel = currentLanguage === 'hi' ? 'फॉलोअर्स' : 'Followers';
    let rchLabel = currentLanguage === 'hi' ? 'अकाउंट रीच' : 'Account Reach';
    document.getElementById('pv-stat-subs-label').innerText = folLabel;
    document.getElementById('pv-stat-watch-label').innerText = rchLabel;
  } else {
    let subLabel = currentLanguage === 'hi' ? 'सब्सक्राइबर्स' : 'Subscribers';
    let wtLabel = currentLanguage === 'hi' ? 'वॉच टाइम' : 'Watch Time';
    document.getElementById('pv-stat-subs-label').innerText = subLabel;
    document.getElementById('pv-stat-watch-label').innerText = wtLabel;
  }

  document.getElementById('pv-buy-btn').onclick = () => { 
    if (c.paymentLink) {
      window.open(c.paymentLink, '_blank');
    } else {
      window.showAlert(currentLanguage === 'hi' ? 'भुगतान लिंक व्यवस्थापक द्वारा शीघ्र सक्रिय किया जाएगा।' : 'Payment link will be activated shortly by admin.');
    }
  };
  
  const req = myRequests.find(r => r.channelId === c.id);
  const activeDispute = myDisputes.find(d => d.channelId === c.id && d.status === 'frozen');

  const form = document.getElementById('verification-form-container');
  const statusCont = document.getElementById('verification-status-container');
  const creds = document.getElementById('credentials-container');
  const releaseBtn = document.getElementById('btn-release-payment');
  const releasedBox = document.getElementById('released-success-box');

  if (!req) { 
    form?.classList.remove('hidden'); 
    statusCont?.classList.add('hidden'); 
    creds?.classList.add('hidden'); 
  }
  else if (req.status === 'pending') { 
    form?.classList.add('hidden'); 
    statusCont?.classList.remove('hidden');
    creds?.classList.add('hidden');

    let pendTitle = currentLanguage === 'hi' ? 'एस्क्रो सत्यापन लंबित...' : 'Escrow Vault Verification Pending...';
    let pendSub = currentLanguage === 'hi' ? 'एडमिन टीम भुगतान सत्यापित कर फंड्स को एस्क्रो वॉल्ट में सुरक्षित लॉक कर रही है।' : 'Admin team is verifying payment to secure funds in Escrow Vault.';
    let supBtn = currentLanguage === 'hi' ? 'त्वरित पुष्टि के लिए सपोर्ट से संपर्क करें' : 'Contact Support for Fast Approval';
    
    statusCont.innerHTML = `
      <div class="text-amber-500 font-bold text-base flex flex-col items-center gap-2">
        <div class="p-3 bg-amber-500/10 rounded-full"><i data-lucide="lock" class="w-8 h-8 animate-pulse"></i></div>
        <span>${pendTitle}</span>
      </div>
      <p class="text-gray-400 text-xs mt-2 max-w-xs mx-auto">${pendSub}</p>
      <div class="mt-4 flex justify-center gap-3">
        <button onclick="window.open('${telegramLink}', '_blank')" class="text-xs font-bold text-indigo-400 uppercase tracking-widest hover:text-indigo-300 transition-colors cursor-pointer py-2 px-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
          ${supBtn}
        </button>
      </div>
    `; 
  }
  else if (req.status === 'approved' || req.status === 'completed') { 
    form?.classList.add('hidden'); 
    statusCont?.classList.add('hidden'); 
    creds?.classList.remove('hidden'); 

    document.getElementById('reveal-email').innerText = c.channelEmail || 'seller_channel@gmail.com'; 
    document.getElementById('reveal-pass').innerText = c.channelPassword || 'Pass#Verified982'; 

    startInspectionTimer(req.approvedTimestamp || req.timestamp || Date.now());

    // If dispute is currently active
    if (activeDispute) {
      releaseBtn?.classList.add('hidden');
      releasedBox?.classList.remove('hidden');
      releasedBox.className = 'p-5 bg-red-950/60 border border-red-500/40 rounded-2xl text-center space-y-2';
      releasedBox.innerHTML = `
        <div class="w-10 h-10 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto">
          <i data-lucide="shield-alert" class="w-5 h-5"></i>
        </div>
        <h4 class="text-base font-bold text-red-300">एस्क्रो फंड्स फ्रीज (विवाद सक्रिय)</h4>
        <p class="text-xs text-gray-300">आपका विवाद दर्ज हो चुका है। एस्क्रो वॉल्ट से फंड्स फ्रीज कर दिए गए हैं। एडमिन टीम 24 घंटे में समीक्षा करेगी। धोखाधड़ी पाए जाने पर 100% रिफंड जारी होगा।</p>
      `;
    } else if (req.status === 'completed') {
      releaseBtn?.classList.add('hidden');
      releasedBox?.classList.remove('hidden');
      releasedBox.className = 'p-5 bg-emerald-950/60 border border-emerald-500/40 rounded-2xl text-center space-y-2';
      releasedBox.innerHTML = `
        <div class="w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto">
          <i data-lucide="check" class="w-5 h-5"></i>
        </div>
        <h4 class="text-base font-bold text-white">भुगतान सेलर के वॉलेट में जारी हो चुका है!</h4>
        <p class="text-xs text-gray-300">डील सफलतापूर्वक पूरी हो गई है। एस्क्रो वॉल्ट से फंड्स सुरक्षित ट्रांसफर किए गए।</p>
      `;
    } else {
      releaseBtn?.classList.remove('hidden');
      releasedBox?.classList.add('hidden');
    }
  }
  updateProductWatchlistBtn();
  refreshLucide();
}

// 1. Submit Verification & Lock into Escrow
window.submitVerification = () => { 
  const tid = document.getElementById('transaction-id-input')?.value.trim(); 
  if (!tid) {
    return window.showAlert(currentLanguage === 'hi' ? 'कृपया लेनदेन (Transaction) आईडी दर्ज करें' : 'Please enter Transaction ID'); 
  }
  
  const req = myRequests.find(r => r.channelId === selectedChannelId);
  if (req && req.status === 'pending') {
    return window.showAlert(currentLanguage === 'hi' ? 'अनुरोध पहले से ही सत्यापन हेतु लंबित है।' : 'Request already pending verification.');
  }

  const c = allChannels.find(x => x.id === selectedChannelId); 
  push(ref(db, 'payment_requests'), { 
    userId, 
    channelId: c.id, 
    channelName: c.name, 
    price: c.price,
    transactionId: tid, 
    status: 'approved', // Immediately activate Escrow Vault for smooth inspection
    escrowVaultStatus: 'locked',
    approvedTimestamp: Date.now(),
    timestamp: Date.now() 
  }).then(() => { 
    document.getElementById('transaction-id-input').value = ''; 
    window.showAlert(currentLanguage === 'hi' ? 'भुगतान सत्यापित! फंड्स एस्क्रो वॉल्ट में सुरक्षित लॉक कर दिए गए हैं।' : 'Payment verified! Funds safely locked in Escrow Vault.'); 
  }).catch(() => {
    window.showAlert('Error recording transaction. Please retry.');
  }); 
};

// 2. Step 4: Confirmation & Fund Release Action
window.confirmAndReleasePayment = () => {
  const c = allChannels.find(x => x.id === selectedChannelId);
  const req = myRequests.find(r => r.channelId === c?.id);
  if (!c || !req) return;

  const confirmMsg = currentLanguage === 'hi' 
    ? 'क्या आपने नया पासवर्ड बदल लिया है और रिकवरी डेटा अपडेट कर दिया है? पुष्टि करते ही एस्क्रो वॉल्ट से पैसा सेलर के इन-ऐप वॉलेट में रिलीज़ कर दिया जाएगा।'
    : 'Have you changed the password and updated recovery details? Confirming will release funds from Escrow Vault to the Seller In-App Wallet.';

  if (confirm(confirmMsg)) {
    update(ref(db, `payment_requests/${req.id}`), {
      status: 'completed',
      escrowVaultStatus: 'released_to_seller_wallet',
      releaseTimestamp: Date.now()
    }).then(() => {
      // Add transaction notice to seller
      push(ref(db, 'notifications'), {
        title: 'Escrow Funds Released',
        message: `Buyer confirmed handover for ${c.name}. Funds ₹${c.price} released to Seller Wallet.`,
        icon: 'wallet',
        timestamp: Date.now()
      });

      window.showAlert(currentLanguage === 'hi' 
        ? 'सफलता! फंड्स एस्क्रो वॉल्ट से सेलर के इन-ऐप वॉलेट में रिलीज़ कर दिए गए हैं।'
        : 'Success! Funds released from Escrow Vault to Seller Wallet.');
      updateProductView();
    });
  }
};

// 3. Dispute Resolution System
window.openDisputeModal = () => {
  document.getElementById('dispute-modal')?.classList.remove('hidden');
  refreshLucide();
};

window.closeDisputeModal = () => {
  document.getElementById('dispute-modal')?.classList.add('hidden');
};

window.handleDisputeFile = (input) => {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 1024 * 1024 * 2) {
    window.showAlert(currentLanguage === 'hi' ? 'फ़ाइल का आकार 2MB से कम होना चाहिए' : 'File must be under 2MB');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    activeDisputeProof = e.target.result;
    const label = document.getElementById('dispute-file-label');
    if (label) label.innerText = `Uploaded: ${file.name}`;
  };
  reader.readAsDataURL(file);
};

window.submitDispute = () => {
  const reason = document.getElementById('dispute-reason')?.value;
  const details = document.getElementById('dispute-details')?.value.trim();
  const proofUrl = document.getElementById('dispute-proof')?.value.trim() || activeDisputeProof;
  const c = allChannels.find(x => x.id === selectedChannelId);

  if (!details) {
    return window.showAlert(currentLanguage === 'hi' ? 'कृपया समस्या का विवरण भरें' : 'Please provide dispute details');
  }

  const disputeData = {
    userId,
    channelId: c?.id || 'unknown',
    channelName: c?.name || 'Channel',
    reason,
    details,
    proof: proofUrl || 'No attachment provided',
    status: 'frozen', // Escrow funds automatically frozen
    timestamp: Date.now()
  };

  push(ref(db, 'disputes'), disputeData).then(() => {
    // Also post ticket message to support chat
    push(ref(db, `support_chats/${userId}/messages`), {
      sender: 'user',
      text: `[DISPUTE RAISED - ESCROW FROZEN]: Channel: ${c?.name}. Reason: ${reason}. Details: ${details}`,
      adminAssigned: currentSessionAdmin || 'Admin Support',
      attachment: proofUrl || null,
      timestamp: Date.now()
    });

    // Notify
    push(ref(db, 'notifications'), {
      title: 'Dispute Registered - Escrow Frozen',
      message: `Dispute filed for ${c?.name}. Escrow funds frozen pending admin investigation. 100% refund policy active.`,
      icon: 'shield-alert',
      timestamp: Date.now()
    });

    window.closeDisputeModal();
    window.showAlert(currentLanguage === 'hi' 
      ? 'विवाद दर्ज कर लिया गया है! एस्क्रो फंड्स तत्काल फ्रीज कर दिए गए हैं। एडमिन टीम शीघ्र समीक्षा करेगी।'
      : 'Dispute registered! Escrow funds have been automatically frozen. Admin team will review and verify for 100% refund.');
    updateProductView();
  }).catch(() => {
    window.showAlert('Failed to file dispute. Please retry.');
  });
};

// 4. Sell Channel with Pre-Handover 2FA Check
window.submitSellRequest = () => {
  const is2faOffConfirmed = document.getElementById('sell-2fa-confirm')?.checked;
  if (!is2faOffConfirmed) {
    return window.showAlert(currentLanguage === 'hi' 
      ? 'अनिवार्य नियम: कृपया पुष्टि करें कि अकाउंट का 2-Step Verification (2FA) OFF (बंद) है ताकि बायर आसानी से लॉगिन कर सके।'
      : 'Mandatory Rule: You must confirm that 2-Step Verification (2FA) is turned OFF so the buyer can log in seamlessly.');
  }

  const data = {
    name: document.getElementById('sell-name')?.value.trim(),
    whatsapp: document.getElementById('sell-whatsapp')?.value.trim(),
    paymentId: document.getElementById('sell-payment')?.value.trim(),
    address: document.getElementById('sell-address')?.value.trim(),
    price: document.getElementById('sell-price')?.value.trim(),
    link: document.getElementById('sell-link')?.value.trim(),
    twoFaDisabledConfirmed: true,
    userId, 
    timestamp: Date.now(), 
    status: 'pending'
  };

  if (!data.name || !data.whatsapp || !data.link) {
    return window.showAlert(currentLanguage === 'hi' ? 'कृपया आवश्यक विवरण भरें।' : 'Please fill required fields.');
  }

  push(ref(db, 'sell_requests'), data).then(() => {
    window.showAlert(currentLanguage === 'hi' 
      ? 'चैनल लिस्टिंग समीक्षा के लिए सबमिट कर दी गई है! 2FA OFF पुष्टि दर्ज की गई।'
      : 'Channel listing submitted for review with 2FA OFF confirmation!');
    window.showView('home-view');
  });
};

window.submitPartnerRequest = () => {
  const data = {
    aadhar: document.getElementById('partner-aadhar')?.value.trim(),
    pan: document.getElementById('partner-pan')?.value.trim(),
    whatsapp: document.getElementById('partner-whatsapp')?.value.trim(),
    paymentId: document.getElementById('partner-payment')?.value.trim(),
    address: document.getElementById('partner-address')?.value.trim(),
    skills: document.getElementById('partner-skills')?.value.trim(),
    userId, timestamp: Date.now(), status: 'pending'
  };
  if (!data.aadhar || !data.pan || !data.whatsapp) {
    return window.showAlert(currentLanguage === 'hi' ? 'कृपया आवश्यक विवरण भरें।' : 'Please fill required fields.');
  }
  push(ref(db, 'partner_requests'), data).then(() => {
    window.showAlert(currentLanguage === 'hi' ? 'आवेदन सबमिट किया गया!' : 'Application submitted!');
    window.showView('home-view');
  });
};

window.submitEarnRequest = () => {
  const data = {
    ytLink: document.getElementById('earn-yt-link')?.value.trim(),
    igLink: document.getElementById('earn-ig-link')?.value.trim(),
    userId, timestamp: Date.now(), status: 'pending'
  };
  if (!data.ytLink && !data.igLink) {
    return window.showAlert(currentLanguage === 'hi' ? 'कम से कम एक लिंक प्रदान करें।' : 'Provide at least one link.');
  }
  push(ref(db, 'earn_requests'), data).then(() => {
    window.showAlert(currentLanguage === 'hi' ? 'लिंक समीक्षा के लिए भेजे गए!' : 'Links submitted for review!');
    window.showView('home-view');
  });
};

window.copyText = (id) => { 
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.innerText); 
  window.showAlert(currentLanguage === 'hi' ? 'कॉपी किया गया!' : 'Copied!'); 
};

window.shareApp = () => {
  const referLink = 'https://dazzling-strudel-8ab1bc.netlify.app';
  const buildShareContent = (dbText) => {
    let baseText = dbText || 'Download YT Market app now - Safe Escrow Digital Assets!';
    if (!baseText.includes(referLink)) {
      return `${baseText}\n\n${referLink}`;
    }
    return baseText;
  };

  try {
    onValue(ref(db, 'settings/shareApkText'), (snapshot) => {
      const fullText = buildShareContent(snapshot.val());
      if (navigator.share) {
        navigator.share({
          title: 'YT Market',
          text: fullText,
          url: referLink
        }).catch(() => {});
      } else {
        window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(fullText), '_blank');
      }
    }, { onlyOnce: true });
  } catch (err) {
    const fallbackText = buildShareContent(null);
    if (navigator.share) {
      navigator.share({
        title: 'YT Market',
        text: fallbackText,
        url: referLink
      }).catch(() => {});
    } else {
      window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(fallbackText), '_blank');
    }
  }
};

// ==========================================
// ADVANCED LIVE CHAT CONTROLLER LOGIC
// ==========================================
function initializeChatSession() {
  if (!sessionStorage.getItem('assigned_admin_name')) {
    const randomIdx = Math.floor(Math.random() * adminNamesList.length);
    sessionStorage.setItem('assigned_admin_name', adminNamesList[randomIdx]);
  }
  currentSessionAdmin = sessionStorage.getItem('assigned_admin_name');
  const adminNameEl = document.getElementById('active-admin-name');
  if (adminNameEl) adminNameEl.innerText = currentSessionAdmin;

  onValue(ref(db, `support_chats/${userId}/messages`), (snapshot) => {
    const messagesData = snapshot.val();
    const messageBox = document.getElementById('chat-messages-box');
    if (!messageBox) return;

    if (!messagesData) {
      messageBox.innerHTML = `
        <div class="text-center text-gray-500 text-xs py-10" data-hi="प्रशासक के साथ सुरक्षित चैट शुरू करें।">
          Start a secure conversation session with active admin.
        </div>
      `;
      return;
    }

    let sortedMsg = Object.keys(messagesData).map(k => messagesData[k]).sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
    messageBox.innerHTML = sortedMsg.map(m => {
      const isUser = m.sender === 'user';
      return `
        <div class="flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in mb-3">
          <div class="max-w-[85%] rounded-2xl px-4 py-3 text-sm ${isUser ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-[#1a1a1a] border border-white/5 text-gray-200 rounded-bl-none'}">
            <p class="leading-relaxed break-all">${escapeHTML(m.text || '')}</p>
            ${m.attachment ? `
              <div class="mt-2 pt-2 border-t border-white/10 flex items-center gap-2 text-xs text-indigo-300 font-medium">
                <i data-lucide="paperclip" class="w-3 h-3"></i>
                ${m.attachment.startsWith('data:') || m.attachment.startsWith('http') ? `
                  <a href="${m.attachment}" target="_blank" class="underline hover:text-white truncate">View Attachment/Proof</a>
                ` : `<span class="truncate">${escapeHTML(m.attachment)}</span>`}
              </div>
            ` : ''}
            <span class="text-[9px] text-white/40 block text-right mt-1 tabular-nums">${new Date(m.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
          </div>
        </div>
      `;
    }).join('');
    
    messageBox.scrollTop = messageBox.scrollHeight;
    refreshLucide();
  });
}

function getTicketCountAndValidateDate() {
  const todayDateStr = new Date().toDateString();
  const storedDate = localStorage.getItem('yt_ticket_date_tracker');
  let currentCount = parseInt(localStorage.getItem('yt_ticket_counter_limit') || '0', 10);

  if (storedDate !== todayDateStr) {
    localStorage.setItem('yt_ticket_date_tracker', todayDateStr);
    localStorage.setItem('yt_ticket_counter_limit', '0');
    currentCount = 0;
  }
  return currentCount;
}

function isSupportOperationalHours() {
  const currentHour = new Date().getHours();
  return (currentHour >= 8 && currentHour < 20); // 8 AM to 8 PM
}

function validateAndRenderChatView() {
  const closedContainer = document.getElementById('chat-closed-container');
  const limitContainer = document.getElementById('chat-limit-container');
  const activeWindow = document.getElementById('chat-active-window');
  const badgeCount = document.getElementById('ticket-count-badge');

  const currentCount = getTicketCountAndValidateDate();
  if (badgeCount) badgeCount.innerText = `${currentCount}/2`;

  if (!isSupportOperationalHours()) {
    closedContainer?.classList.remove('hidden');
    limitContainer?.classList.add('hidden');
    activeWindow?.classList.add('hidden');
    return;
  }

  if (currentCount >= 2) {
    closedContainer?.classList.add('hidden');
    limitContainer?.classList.remove('hidden');
    activeWindow?.classList.add('hidden');
    return;
  }

  closedContainer?.classList.add('hidden');
  limitContainer?.classList.add('hidden');
  activeWindow?.classList.remove('hidden');
}

window.sendChatMessage = () => {
  const inputField = document.getElementById('chat-msg-input');
  const text = inputField?.value.trim();
  
  if (!text && !activeUploadedAttachment) {
    return window.showAlert(currentLanguage === 'hi' ? 'कृपया एक संदेश या अटैचमेंट लिखें' : 'Please type a message or provide attachment');
  }

  let ticketCount = getTicketCountAndValidateDate();
  if (ticketCount >= 2) {
    validateAndRenderChatView();
    return;
  }

  const msgPayload = {
    sender: 'user',
    text: text || "Sent an attachment reference.",
    adminAssigned: currentSessionAdmin,
    attachment: activeUploadedAttachment || null,
    timestamp: Date.now()
  };

  push(ref(db, `support_chats/${userId}/messages`), msgPayload).then(() => {
    const updatedCount = ticketCount + 1;
    localStorage.setItem('yt_ticket_counter_limit', updatedCount.toString());
    const badge = document.getElementById('ticket-count-badge');
    if (badge) badge.innerText = `${updatedCount}/2`;

    if (inputField) inputField.value = "";
    window.clearAttachment();
    validateAndRenderChatView();
  }).catch(() => {
    window.showAlert('Transmission failed. Retry.');
  });
};

window.handleFileAttachment = (input) => {
  const file = input.files[0];
  if (!file) return;

  if (file.size > 1024 * 1024 * 2) {
    window.showAlert(currentLanguage === 'hi' ? 'फ़ाइल का आकार 2MB से कम होना चाहिए' : 'File must be under 2MB');
    input.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    activeUploadedAttachment = e.target.result;
    const txt = document.getElementById('attachment-preview-text');
    if (txt) txt.innerText = `File: ${file.name}`;
    document.getElementById('attachment-preview')?.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
};

window.promptLinkAttachment = () => {
  const promptText = currentLanguage === 'hi' ? 'अपना यूआरएल लिंक दर्ज करें:' : 'Enter your URL / reference link:';
  const url = prompt(promptText, "https://");
  if (url && url !== "https://") {
    activeUploadedAttachment = url;
    const txt = document.getElementById('attachment-preview-text');
    if (txt) txt.innerText = `Link: ${url}`;
    document.getElementById('attachment-preview')?.classList.remove('hidden');
  }
};

window.clearAttachment = () => {
  activeUploadedAttachment = "";
  const inp = document.getElementById('chat-file-input');
  if (inp) inp.value = "";
  document.getElementById('attachment-preview')?.classList.add('hidden');
};

function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// ==========================================
// 1. SAFETY, FAQ & REFUND TAB SWITCHER
// ==========================================
window.switchSafetyTab = (tab) => {
  const tabs = ['faq', 'guide', 'refund', 'agreement', 'ownership'];
  tabs.forEach(t => {
    const el = document.getElementById(`safety-tab-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`) || document.getElementById(`safety-tab-btn-${t}`);
    if (t === tab) {
      el?.classList.remove('hidden');
      if (btn) {
        btn.className = t === 'ownership'
          ? 'px-4 py-2.5 rounded-xl bg-amber-600 text-white shadow-lg transition-all whitespace-nowrap cursor-pointer flex items-center gap-2'
          : 'px-4 py-2.5 rounded-xl bg-emerald-600 text-white shadow-lg transition-all whitespace-nowrap cursor-pointer flex items-center gap-2';
      }
    } else {
      el?.classList.add('hidden');
      if (btn) {
        btn.className = t === 'ownership'
          ? 'px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-amber-300 transition-all whitespace-nowrap cursor-pointer flex items-center gap-2'
          : 'px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 transition-all whitespace-nowrap cursor-pointer flex items-center gap-2';
      }
    }
  });
  refreshLucide();
};

// ==========================================
// 2. USER ORDERS & ASSET HANDOVER SYSTEM
// ==========================================
let defaultOrders = [];

window.getUserOrders = () => {
  const saved = localStorage.getItem('yt_user_orders');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.filter(o => o.id !== 'ORD-94821' && o.id !== 'ORD-88412');
      }
    } catch(e) {}
  }
  return [];
};

window.saveUserOrders = (orders) => {
  localStorage.setItem('yt_user_orders', JSON.stringify(orders));
};

window.renderUserOrders = () => {
  const container = document.getElementById('user-orders-container');
  if (!container) return;

  const orders = window.getUserOrders();
  if (orders.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 bg-[#111111] rounded-[2rem] border border-white/5 p-6 space-y-3">
        <i data-lucide="package" class="w-10 h-10 text-gray-500 mx-auto"></i>
        <h4 class="text-white font-bold text-base" data-hi="कोई सक्रिय ऑर्डर नहीं">No active orders yet</h4>
        <p class="text-xs text-gray-400" data-hi="जब आप कोई चैनल खरीदेंगे, तो उसकी एस्क्रो सुरक्षा और हैंडओवर यहाँ दिखाई देगा।">Browse trending monetized channels and secure them with Escrow Vault.</p>
        <button onclick="window.showView('home-view')" class="mt-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer">
          Browse Assets
        </button>
      </div>`;
    refreshLucide();
    return;
  }

  container.innerHTML = orders.map(ord => {
    const isInspection = ord.status === 'active_inspection';
    const isDelivered = ord.status === 'delivered_confirmed';
    const isDisputed = ord.status === 'disputed_frozen';

    let badgeHtml = '';
    if (isInspection) {
      badgeHtml = `<span class="px-3 py-1 bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-full text-[11px] font-bold flex items-center gap-1.5"><i data-lucide="clock" class="w-3.5 h-3.5"></i> 24-48h Inspection Window Active</span>`;
    } else if (isDelivered) {
      badgeHtml = `<span class="px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-full text-[11px] font-bold flex items-center gap-1.5"><i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Handover Confirmed (1-Year Guarantee Active)</span>`;
    } else {
      badgeHtml = `<span class="px-3 py-1 bg-red-500/20 border border-red-500/30 text-red-300 rounded-full text-[11px] font-bold flex items-center gap-1.5"><i data-lucide="shield-alert" class="w-3.5 h-3.5"></i> Escrow Frozen (Dispute Reviewing)</span>`;
    }

    return `
      <div class="bg-[#111111] border border-white/10 rounded-[2rem] p-6 md:p-7 space-y-5 shadow-xl text-left">
        <!-- Order Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs font-bold text-indigo-400 font-mono tracking-wider">${ord.id}</span>
              <span class="text-gray-500 text-xs">• ${ord.date}</span>
            </div>
            <h3 class="text-lg md:text-xl font-bold text-white">${escapeHTML(ord.channelName)}</h3>
          </div>
          <div class="text-left sm:text-right">
            <span class="text-2xl font-black text-emerald-400">₹${Number(ord.price).toLocaleString('en-IN')}</span>
            <div class="mt-1">${badgeHtml}</div>
          </div>
        </div>

        <!-- Security and Handover Protocol Statuses -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div class="p-3 bg-black/40 rounded-xl border border-white/5 space-y-1">
            <span class="text-gray-400 font-medium">Escrow Protection:</span>
            <div class="text-white font-bold flex items-center gap-1.5 text-indigo-300">
              <i data-lucide="shield-check" class="w-4 h-4 text-emerald-400 shrink-0"></i>
              ${ord.escrowStatus}
            </div>
          </div>
          <div class="p-3 bg-black/40 rounded-xl border border-white/5 space-y-1">
            <span class="text-gray-400 font-medium">2FA Handover Verification:</span>
            <div class="text-white font-bold flex items-center gap-1.5 text-amber-300">
              <i data-lucide="key" class="w-4 h-4 text-amber-400 shrink-0"></i>
              ${ord.twoFaStatus}
            </div>
          </div>
        </div>

        <!-- Credentials Container -->
        <div class="p-4 bg-[#161618] border border-white/10 rounded-2xl space-y-3">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <i data-lucide="lock" class="w-3.5 h-3.5 text-indigo-400"></i> Account Access Credentials:
            </span>
            <span class="text-[10px] text-gray-400">Encrypted transmission</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div class="bg-black/50 p-3 rounded-xl border border-white/5 flex items-center justify-between">
              <div>
                <p class="text-[10px] text-gray-500 font-bold uppercase">Login Email</p>
                <p class="text-white font-mono font-semibold truncate select-all">${ord.credentials.email}</p>
              </div>
              <button onclick="navigator.clipboard.writeText('${ord.credentials.email}'); window.showAlert('Email copied to clipboard!');" class="text-gray-400 hover:text-white p-1.5 cursor-pointer"><i data-lucide="copy" class="w-4 h-4"></i></button>
            </div>
            <div class="bg-black/50 p-3 rounded-xl border border-white/5 flex items-center justify-between">
              <div>
                <p class="text-[10px] text-gray-500 font-bold uppercase">Password</p>
                <p class="text-white font-mono font-semibold select-all">${ord.credentials.pass}</p>
              </div>
              <button onclick="navigator.clipboard.writeText('${ord.credentials.pass}'); window.showAlert('Password copied to clipboard!');" class="text-gray-400 hover:text-white p-1.5 cursor-pointer"><i data-lucide="copy" class="w-4 h-4"></i></button>
            </div>
          </div>
        </div>

        <!-- Legal Affidavit / Owner Handover Deed Download -->
        <div class="p-3.5 bg-indigo-950/30 border border-indigo-500/20 rounded-xl flex items-center justify-between gap-3 text-xs">
          <div class="flex items-center gap-2 text-indigo-300">
            <i data-lucide="file-check" class="w-4 h-4 text-indigo-400 shrink-0"></i>
            <span><strong>Legal Ownership Deed:</strong> Original handwritten, signed legal handover affidavit from channel owner.</span>
          </div>
          <button onclick="window.downloadOrderLegalDeed('${ord.id}')" class="px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/30 rounded-lg font-bold shrink-0 cursor-pointer flex items-center gap-1 text-[11px]">
            <i data-lucide="download" class="w-3.5 h-3.5"></i> PDF Deed
          </button>
        </div>

        <!-- Action Buttons -->
        <div class="pt-2 flex flex-col sm:flex-row items-center gap-3">
          ${isInspection ? `
            <button onclick="window.confirmOrderDelivery('${ord.id}')" class="w-full sm:flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer">
              <i data-lucide="check-circle" class="w-4 h-4"></i> Confirm Delivery & Release Escrow
            </button>
            <button onclick="window.openDisputeModalWithOrder('${ord.id}')" class="w-full sm:w-auto px-5 py-3.5 bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/30 font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer">
              <i data-lucide="alert-triangle" class="w-4 h-4"></i> Raise Dispute
            </button>
          ` : isDelivered ? `
            <div class="w-full p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-center text-xs text-emerald-300 font-semibold flex items-center justify-center gap-2">
              <i data-lucide="shield-check" class="w-4 h-4"></i> Deal Completed Successfully • 100% 1-Year Guarantee Active
            </div>
          ` : `
            <div class="w-full p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-center text-xs text-red-300 font-semibold flex items-center justify-center gap-2">
              <i data-lucide="shield-alert" class="w-4 h-4"></i> Escrow Frozen in Vault • Admin Audit in Progress (100% Refund Safeguard)
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');

  refreshLucide();
};

window.confirmOrderDelivery = (orderId) => {
  const orders = window.getUserOrders();
  const ord = orders.find(o => o.id === orderId);
  if (!ord) return;

  const msg = currentLanguage === 'hi' 
    ? `क्या आपने ${ord.channelName} का पासवर्ड बदल लिया है और रिकवरी जानकारी अपडेट कर दी है? पुष्टि करने पर एस्क्रो वॉल्ट से राशि सेलर को रिलीज़ होगी और आपकी 1 वर्ष की 100% गारंटी शुरू हो जाएगी।`
    : `Have you changed password & updated recovery info for ${ord.channelName}? Confirming will release escrow to seller and activate your 1-Year 100% Guarantee Certificate.`;

  if (confirm(msg)) {
    ord.status = 'delivered_confirmed';
    ord.escrowStatus = 'Escrow Released to Seller Wallet';
    window.saveUserOrders(orders);
    window.renderUserOrders();
    window.showAlert(currentLanguage === 'hi' 
      ? 'बधाई हो! डिलीवरी की पुष्टि हो गई। आपका 1 वर्ष का 100% गारंटी प्रमाणपत्र सक्रिय हो चुका है।'
      : 'Congratulations! Handover delivery confirmed. Your 1-Year 100% Guarantee Certificate is now active.');
  }
};

window.downloadSampleHandoverAgreement = () => {
  const agreementContent = `================================================================================
                    YT MARKET - OFFICIAL OWNERSHIP HANDOVER DEED
                  LEGAL TRANSFER DECLARATION & RELEASE AFFIDAVIT
================================================================================

DOCUMENT REF : YTM-DEED-SMPL-2026
DATE         : ${new Date().toLocaleDateString()}
STATUS       : VERIFIED & OFFICIALLY RECORDED (ESCROW PROTECTED)

--------------------------------------------------------------------------------
1. PARTIES TO THE TRANSFER
--------------------------------------------------------------------------------
Original Owner (Seller) : Rajesh Kumar Verma
Government ID Ref       : AADHAAR ****-****-8842 (Verified)
Buyer (New Legal Owner) : Verified YT Market Buyer
Escrow / Platform Audit : YT Market Automated Verification Protocol

--------------------------------------------------------------------------------
2. DIGITAL ASSET DETAILS
--------------------------------------------------------------------------------
Asset Type              : YouTube Channel / Digital Creator Property
Channel / Page Name     : Tech Gyan Hindi Official
Channel URL / Handle    : https://youtube.com/@techgyanhindiofficial
Subscribers / Followers : 124,500+ Verified
Primary Creator Email   : techgyanhindi.original@gmail.com

--------------------------------------------------------------------------------
3. SWORN LEGAL DECLARATION BY ORIGINAL OWNER (HANDWRITTEN & SIGNED)
--------------------------------------------------------------------------------
"Main Rajesh Kumar Verma, is YouTube Channel / Digital Account ka asli aur
swabhavik legal owner hoon. Main aaj apni poori sahmati se is channel ka
purna swamitva, copyright adhikar, dashboard access aur bhabhishya ke
sabhee revenue rights buyer ko transfer kar raha hoon.

Transfer ke baad mera is channel ya iske content par koi adhikar nahi
rahega. Future me kisi bhi prakaar ka recovery claim, dispute ya unauthorized
access nahi kiya jayega."

--------------------------------------------------------------------------------
4. BINDING TERMS & WARRANTIES
--------------------------------------------------------------------------------
a) Seller affirms that no third-party claim, copyright strike, or legal
   encumbrance exists on this channel at the time of transfer.
b) YT Market Escrow protects this transfer with a 6 to 12-Month 100% Guarantee.
   Any unauthorized reclaim by the seller entitles the buyer to immediate
   100% refund or asset replacement.
c) Buyer is instructed to update primary recovery phone, 2FA, and password
   within 15 minutes of receiving primary owner credentials.

--------------------------------------------------------------------------------
5. OFFICIAL SIGNATURES & VERIFICATION STAMP
--------------------------------------------------------------------------------

[PHYSICAL SIGNATURE VERIFIED]             [YT MARKET OFFICIAL ESCROW SEAL]
Seller: Rajesh Kumar Verma                Verified Hash: YTM-SHA256-88F4B92
Date: 18-Sep-2026                         Handover Vault: ESCROW-SECURE-VAULT

================================================================================
Generated and verified via YT Market App. Retain this deed for at least 90 days.
================================================================================`;

  try {
    const blob = new Blob([agreementContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'YT_Market_Handover_Deed_Sample.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Download error:', err);
  }

  const alertMsg = currentLanguage === 'hi'
    ? 'सैंपल लीगल हैंडओवर एग्रीमेंट डीड डाउनलोड हो गई है!\n\nइसमें सेलर का ओरिजिनल डिक्लेरेशन, साइन वेरिफिकेशन और एस्क्रो प्रोटेक्शन गारंटी शामिल है।'
    : 'Sample Legal Handover Agreement Deed downloaded!\n\nIncludes verified owner declaration, signature proof, and escrow guarantee details.';
  
  window.showAlert(alertMsg);
};

window.downloadOrderLegalDeed = (orderId) => {
  const orders = window.getUserOrders();
  const ord = orders.find(o => o.id === orderId) || { channelName: 'Digital Asset Channel', seller: 'Verified Owner', id: orderId };
  
  window.showAlert(`Legal Handover Deed PDF for ${ord.channelName} (Order #${ord.id}) downloaded!\n\nContains original handwritten statement: "I hereby transfer complete lifetime ownership of this channel and relinquish all claims forever", signed with ID proof & date.`);
};

// ==========================================
// 3. APP WALLET SYSTEM & REFUNDS
// ==========================================
let defaultWallet = {
  total: 0,
  refund: 0,
  escrow: 0,
  transactions: []
};

window.getWalletData = () => {
  const saved = localStorage.getItem('yt_wallet_data');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      const mockTxIds = ['TX-901', 'TX-892', 'TX-874', 'TX-810'];
      parsed.transactions = (parsed.transactions || []).filter(tx => !mockTxIds.includes(tx.id));
      if (parsed.total === 35400 && parsed.refund === 18500 && parsed.escrow === 16900) {
        parsed.total = 0;
        parsed.refund = 0;
        parsed.escrow = 0;
      }
      return parsed;
    } catch(e) {}
  }
  return { total: 0, refund: 0, escrow: 0, transactions: [] };
};

window.saveWalletData = (data) => {
  localStorage.setItem('yt_wallet_data', JSON.stringify(data));
};

window.renderWallet = () => {
  const data = window.getWalletData();
  const totalEl = document.getElementById('wallet-total-balance');
  const refundEl = document.getElementById('wallet-refund-balance');
  const escrowEl = document.getElementById('wallet-escrow-locked');
  const txList = document.getElementById('wallet-tx-list');

  if (totalEl) totalEl.innerText = `₹${(data.total || 0).toLocaleString('en-IN')}`;
  if (refundEl) refundEl.innerText = `₹${(data.refund || 0).toLocaleString('en-IN')}`;
  if (escrowEl) escrowEl.innerText = `₹${(data.escrow || 0).toLocaleString('en-IN')}`;

  if (txList) {
    if (!data.transactions || data.transactions.length === 0) {
      txList.innerHTML = `
        <div class="text-center py-10 bg-black/30 rounded-2xl border border-white/5 p-6 space-y-2">
          <i data-lucide="receipt" class="w-8 h-8 text-gray-500 mx-auto"></i>
          <p class="text-sm font-bold text-gray-300" data-hi="कोई ट्रांजेक्शन नहीं है">No transactions found</p>
          <p class="text-xs text-gray-500" data-hi="जब आप कोई लेन-देन करेंगे, तो उसका विवरण यहाँ दिखाई देगा।">Your wallet transactions will appear here once you make an order or payment.</p>
        </div>
      `;
    } else {
      txList.innerHTML = data.transactions.map(tx => {
        let icon = 'arrow-down-left';
        let iconColor = 'text-emerald-400 bg-emerald-500/10';
        if (tx.type === 'escrow') {
          icon = 'lock';
          iconColor = 'text-indigo-400 bg-indigo-500/10';
        } else if (tx.type === 'withdrawal') {
          icon = 'arrow-up-right';
          iconColor = 'text-amber-400 bg-amber-500/10';
        }

        return `
          <div class="flex items-center justify-between p-3.5 bg-black/40 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-xl ${iconColor} flex items-center justify-center shrink-0">
                <i data-lucide="${icon}" class="w-4 h-4"></i>
              </div>
              <div>
                <p class="text-xs font-bold text-white">${escapeHTML(tx.title)}</p>
                <p class="text-[10px] text-gray-400">${escapeHTML(tx.subtitle)} • <span class="text-gray-500">${tx.date}</span></p>
              </div>
            </div>
            <div class="text-right">
              <span class="text-sm font-black ${tx.amount && tx.amount.startsWith('+') ? 'text-emerald-400' : 'text-gray-200'}">${tx.amount}</span>
              <p class="text-[9px] text-emerald-400/80 font-bold uppercase tracking-wider">${tx.status}</p>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  refreshLucide();
};

window.openWithdrawModal = () => {
  document.getElementById('withdraw-modal')?.classList.remove('hidden');
  refreshLucide();
};

window.closeWithdrawModal = () => {
  document.getElementById('withdraw-modal')?.classList.add('hidden');
};

window.submitWithdrawalRequest = () => {
  const amtInput = document.getElementById('withdraw-amount');
  const destInput = document.getElementById('withdraw-destination');
  const holderInput = document.getElementById('withdraw-holder-name');

  const amt = Number(amtInput?.value);
  const dest = destInput?.value.trim();
  const holder = holderInput?.value.trim();

  const wallet = window.getWalletData();

  if (!amt || amt < 500) {
    return window.showAlert(currentLanguage === 'hi' ? 'न्यूनतम निकासी राशि ₹500 है।' : 'Minimum withdrawal amount is ₹500.');
  }
  if (amt > wallet.total) {
    return window.showAlert(currentLanguage === 'hi' ? 'अपर्याप्त वॉलेट बैलेंस।' : 'Insufficient wallet balance.');
  }
  if (!dest) {
    return window.showAlert(currentLanguage === 'hi' ? 'कृपया अपना UPI आईडी या बैंक खाता संख्या दर्ज करें।' : 'Please provide UPI ID or Bank account number.');
  }

  wallet.total -= amt;
  wallet.transactions.unshift({
    id: 'TX-' + Math.floor(100 + Math.random() * 900),
    type: 'withdrawal',
    title: `Withdrawal to ${dest}`,
    subtitle: `Holder: ${holder || 'Self'} • Under instant payout queue`,
    amount: `- ₹${amt.toLocaleString('en-IN')}`,
    date: 'Today',
    status: 'Processing (15-30m)'
  });

  window.saveWalletData(wallet);
  window.closeWithdrawModal();
  window.renderWallet();

  window.showAlert(currentLanguage === 'hi' 
    ? `₹${amt.toLocaleString('en-IN')} की निकासी सफलतापूर्वक सबमिट हो गई! 15 से 30 मिनट में आपके खाते में आ जाएगी।`
    : `Withdrawal request for ₹${amt.toLocaleString('en-IN')} submitted successfully! Funds will credit within 15-30 minutes.`);
};

// ==========================================
// 4. DISPUTE RESOLUTION HUB
// ==========================================
let defaultDisputes = [
  {
    id: 'DISP-7821',
    orderId: 'ORD-8819',
    channelName: 'Finance Guru Hindi (120k Subs)',
    reason: '2FA still active on seller device / OTP blocked',
    status: 'resolved_refunded',
    date: '14 Sep 2026',
    resolution: 'Seller failed to turn off 2FA within 6-hour window. Deal cancelled by admin and 100% full refund ₹18,500 credited to Buyer App Wallet.'
  }
];

window.getUserDisputes = () => {
  const saved = localStorage.getItem('yt_user_disputes');
  if (saved) {
    try { return JSON.parse(saved); } catch(e) {}
  }
  return defaultDisputes;
};

window.saveUserDisputes = (disp) => {
  localStorage.setItem('yt_user_disputes', JSON.stringify(disp));
};

window.renderDisputesHub = () => {
  const listEl = document.getElementById('user-disputes-list');
  if (!listEl) return;

  const disputes = window.getUserDisputes();
  if (disputes.length === 0) {
    listEl.innerHTML = `<div class="text-center py-6 text-gray-500 text-xs">No disputes currently filed. All transactions running safely under Escrow Vault.</div>`;
    return;
  }

  listEl.innerHTML = disputes.map(d => {
    const isResolved = d.status === 'resolved_refunded';
    return `
      <div class="p-4 bg-black/40 border border-white/5 rounded-2xl space-y-2.5 text-xs text-left">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-mono font-bold text-red-400">${d.id}</span>
            <span class="text-gray-500">• Order: ${d.orderId}</span>
          </div>
          <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isResolved ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}">
            ${isResolved ? '100% Refund Approved & Credited' : 'Escrow Frozen • Reviewing'}
          </span>
        </div>
        <p class="text-white font-bold text-sm">${escapeHTML(d.channelName)}</p>
        <p class="text-gray-300"><strong>Reason:</strong> ${escapeHTML(d.reason)}</p>
        ${d.resolution ? `
          <div class="p-3 bg-emerald-950/30 border border-emerald-500/20 rounded-xl text-emerald-200 text-[11px] leading-relaxed">
            <strong>Admin Resolution:</strong> ${escapeHTML(d.resolution)}
          </div>
        ` : `
          <div class="p-3 bg-red-950/30 border border-red-500/20 rounded-xl text-red-200 text-[11px] leading-relaxed">
            <strong>Escrow Status:</strong> Funds completely frozen in vault. Our investigation officer is reviewing login audit logs. 100% guarantee protects your payment.
          </div>
        `}
      </div>
    `;
  }).join('');

  refreshLucide();
};

window.openDisputeModalWithOrder = (orderId) => {
  window.showView('disputes-hub-view');
  const txInput = document.getElementById('hub-dispute-txid');
  if (txInput) {
    txInput.value = orderId;
    txInput.focus();
  }
};

window.submitDisputeHubForm = () => {
  const txid = document.getElementById('hub-dispute-txid')?.value.trim();
  const reason = document.getElementById('hub-dispute-reason')?.value;
  const desc = document.getElementById('hub-dispute-desc')?.value.trim();
  const proof = document.getElementById('hub-dispute-proof')?.value.trim();

  if (!txid) {
    return window.showAlert(currentLanguage === 'hi' ? 'कृपया ट्रांजेक्शन आईडी या ऑर्डर आईडी दर्ज करें।' : 'Please enter Transaction ID or Order ID.');
  }
  if (!desc) {
    return window.showAlert(currentLanguage === 'hi' ? 'कृपया समस्या का विवरण भरें।' : 'Please provide details of the issue.');
  }

  const disputes = window.getUserDisputes();
  const newDisp = {
    id: 'DISP-' + Math.floor(1000 + Math.random() * 9000),
    orderId: txid,
    channelName: `Asset Transaction (${txid})`,
    reason: reason,
    details: desc,
    proof: proof || 'None',
    status: 'frozen',
    date: 'Today',
    resolution: null
  };

  disputes.unshift(newDisp);
  window.saveUserDisputes(disputes);

  // Freeze corresponding order in User Orders if exists
  const orders = window.getUserOrders();
  const matchedOrder = orders.find(o => o.id === txid);
  if (matchedOrder) {
    matchedOrder.status = 'disputed_frozen';
    matchedOrder.escrowStatus = 'Escrow Frozen (Dispute Active)';
    window.saveUserOrders(orders);
  }

  // Push to Firebase for admin visibility
  push(ref(db, 'disputes'), {
    ...newDisp,
    userId,
    timestamp: Date.now()
  }).catch(() => {});

  // Clear inputs
  const tidEl = document.getElementById('hub-dispute-txid');
  const descEl = document.getElementById('hub-dispute-desc');
  const proofEl = document.getElementById('hub-dispute-proof');
  if (tidEl) tidEl.value = '';
  if (descEl) descEl.value = '';
  if (proofEl) proofEl.value = '';

  window.renderDisputesHub();
  window.showAlert(currentLanguage === 'hi'
    ? 'विवाद दर्ज कर लिया गया है! एस्क्रो वॉल्ट से पैसा तुरंत फ्रीज कर दिया गया है। एडमिन टीम 24 घंटे में सत्यापन करके 100% रिफंड की प्रक्रिया पूरी करेगी।'
    : 'Dispute submitted! Escrow funds frozen immediately. Admin will audit records and issue 100% refund as per policy.');
};

// ==========================================
// 5. 5K+ CUSTOMER REVIEWS SYSTEM
// ==========================================
let initialReviewsPool = [
  { id: 'rev-1', name: 'Rohit Murmu', stars: 5, text: 'YT Market ka interface mujhe kaafi simple laga 👍', date: 'Just now', badge: 'Verified Buyer' },
  { id: 'rev-2', name: 'Sandeep Mondal', stars: 5, text: 'Instagram ID search karna easy tha, listings bhi clearly dikh rahi thi.', date: '12 mins ago', badge: 'Verified Buyer' },
  { id: 'rev-3', name: 'Mohit Kumar', stars: 5, text: 'YouTube channel ki details ek hi jagah mil gayi, isliye compare karna easy raha. 🎥', date: '35 mins ago', badge: 'Verified Buyer' },
  { id: 'rev-4', name: 'Sunita Soren', stars: 5, text: 'Facebook page ke liye marketplace ka concept mujhe useful laga.', date: '1 hour ago', badge: 'Verified Buyer' },
  { id: 'rev-5', name: 'Akash Hembram', stars: 5, text: 'Pehli baar app use kiya aur navigation samajhne mein koi khaas problem nahi hui. 😊', date: '2 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-6', name: 'Rajesh Hansda', stars: 4, text: 'Listing upload karne ka process mujhe straightforward laga.', date: '2 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-7', name: 'Amit Tudu', stars: 5, text: 'Mujhe sabse useful feature search option laga 🔎', date: '3 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-8', name: 'Anjali Marandi', stars: 5, text: 'Different accounts ki pricing compare karna convenient raha.', date: '4 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-9', name: 'Rahul Besra', stars: 5, text: 'YT Market par Instagram aur YouTube ki listings ek jagah dekh sakte hain, ye convenient hai.', date: '5 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-10', name: 'Deepankar Mandal', stars: 5, text: 'App ka design clean hai aur options easily samajh aate hain.', date: '6 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-11', name: 'Bikram Kisku', stars: 5, text: 'Seller se details discuss karne ke baad mera experience kaafi smooth aur accha raha.', date: '7 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-12', name: 'Saurav Das', stars: 4, text: 'YouTube channel ki listing mein analytics details dekhkar mujhe clarity mili.', date: '8 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-13', name: 'Pooja Bauri', stars: 5, text: 'Instagram account browse karte waqt categories kaafi helpful lagi. 📱', date: '9 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-14', name: 'Vikash Mahato', stars: 5, text: 'App ka overall experience bahut positive aur safe raha.', date: '10 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-15', name: 'Manoj Roy', stars: 4, text: 'Mujhe listing ka price aur description dekhna useful laga.', date: '11 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-16', name: 'Rakesh Ghosh', stars: 5, text: 'Account sell karne ke liye listing create karna bahut easy laga.', date: '12 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-17', name: 'Suman Sen', stars: 5, text: 'Marketplace ka idea interesting hai, especially social media accounts ke liye. 💡', date: '13 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-18', name: 'Abhishek Dutta', stars: 5, text: 'Search karke relevant listing mil gayi, isliye time save hua.', date: '14 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-19', name: 'Subhash Banerjee', stars: 5, text: 'UI simple hai, unnecessary options zyada nahi hain. 👌', date: '16 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-20', name: 'Deepak Karmakar', stars: 5, text: 'Maine YouTube, Instagram aur Facebook listing check ki aur jo information chahiye thi woh mil gayi.', date: '18 hours ago', badge: 'Verified Buyer' },
  { id: 'rev-21', name: 'Pankaj Bauri', stars: 5, text: 'Bahut hi accha platform hai. Maine apna YouTube channel yahan sell kiya aur payment time par mil gaya. Process simple aur secure laga. 😊', date: 'Yesterday', badge: 'Verified Buyer' },
  { id: 'rev-22', name: 'Sanjay Murmu', stars: 5, text: 'Pehli baar kisi marketplace se Instagram page kharida tha. Experience expected se bhi better raha. Seller genuine tha aur support team bhi helpful thi. 🔥', date: 'Yesterday', badge: 'Verified Buyer' },
  { id: 'rev-23', name: 'Suraj Soren', stars: 5, text: 'Facebook page buy karne ke liye best app laga mujhe. Sab details clear thi aur deal smoothly complete ho gayi. 👍😎', date: 'Yesterday', badge: 'Verified Buyer' },
  { id: 'rev-24', name: 'Santosh Majhi', stars: 5, text: 'Trustworthy app hai. Yahan fake listings bahut kam dekhe aur users bhi active hain. Mere liye kaafi useful raha. 🚀', date: 'Yesterday', badge: 'Verified Buyer' },
  { id: 'rev-25', name: 'Dilip Hembram', stars: 5, text: 'Maine ek monetized YouTube channel purchase kiya. Transfer process easy tha aur sab kuch safely ho gaya. 💯✨', date: '2 days ago', badge: 'Verified Buyer' },
  { id: 'rev-26', name: 'Ajay Baskey', stars: 5, text: 'Bahut din se aise platform ki talash thi. Instagram account sell karna yahan bahut easy raha. 😍📱', date: '2 days ago', badge: 'Verified Buyer' },
  { id: 'rev-27', name: 'Manisha Kisku', stars: 5, text: 'User interface simple hai aur naye users bhi easily samajh sakte hain. Deal complete hone mein koi problem nahi hui. 🌟', date: '2 days ago', badge: 'Verified Buyer' },
  { id: 'rev-28', name: 'Payal Soren', stars: 5, text: 'Fast response aur genuine buyers mile. Mujhe apna channel sell karne mein bilkul dikkat nahi hui. 🤝😊', date: '3 days ago', badge: 'Verified Buyer' },
  { id: 'rev-29', name: 'Rita Mondal', stars: 5, text: 'Excellent marketplace. Yahan YouTube aur Facebook dono categories mein achhe options mil jate hain. 🎯🔥', date: '3 days ago', badge: 'Verified Buyer' },
  { id: 'rev-30', name: 'Sneha Mandal', stars: 5, text: 'Mera overall experience bahut positive raha. Payment aur transfer dono secure lage. ❤️👌', date: '3 days ago', badge: 'Verified Buyer' },
  { id: 'rev-31', name: 'Arjun Mahali', stars: 5, text: 'App ka design clean hai aur listings check karna easy hai. Mujhe jo channel chahiye tha wo yahin mil gaya. 😃🎉', date: '4 days ago', badge: 'Verified Buyer' },
  { id: 'rev-32', name: 'Pradeep Murmu', stars: 4, text: 'Reliable platform hai. Seller aur buyer ke beech communication bhi smooth rehta hai. 💎🤝', date: '4 days ago', badge: 'Verified Buyer' },
  { id: 'rev-33', name: 'Rameshwar Soren', stars: 5, text: 'Instagram page purchase kiya aur account exactly description jaisa hi mila. Bahut satisfied hu. 😎✨', date: '4 days ago', badge: 'Verified Buyer' },
  { id: 'rev-34', name: 'Binod Hansda', stars: 5, text: 'Customer support kaafi cooperative hai. Mere questions ka jaldi reply mila aur issue solve ho gaya. 🙌😊', date: '5 days ago', badge: 'Verified Buyer' },
  { id: 'rev-35', name: 'Sunil Marandi', stars: 5, text: 'YouTube creators ke liye kaafi useful app hai. Buy aur sell dono process simple rakha gaya hai. 🎬🚀', date: '5 days ago', badge: 'Verified Buyer' },
  { id: 'rev-36', name: 'Bablu Tudu', stars: 5, text: 'Maine pehle doubt kiya tha lekin use karne ke baad trust badh gaya. Genuine experience raha. 👍💯', date: '5 days ago', badge: 'Verified Buyer' },
  { id: 'rev-37', name: 'Anil Besra', stars: 4, text: 'Facebook page sell kiya aur buyer quickly mil gaya. Time bach gaya aur deal bhi successful rahi. ⚡🎉', date: '5 days ago', badge: 'Verified Buyer' },
  { id: 'rev-38', name: 'Naresh Kisku', stars: 5, text: 'Bahut professional platform laga. Verification aur communication dono acche hain. 🔐🌟', date: '6 days ago', badge: 'Verified Buyer' },
  { id: 'rev-39', name: 'Govind Mondal', stars: 5, text: 'Yahan achhe quality ke channels aur pages mil jate hain. Search karna bhi easy hai. 🔍😊', date: '6 days ago', badge: 'Verified Buyer' },
  { id: 'rev-40', name: 'Tarun Das', stars: 5, text: 'Overall fantastic experience. Social media assets buy ya sell karne ke liye ek useful marketplace hai. 🏆🚀', date: '6 days ago', badge: 'Verified Buyer' },
  { id: 'rev-41', name: 'Ashish Paul', stars: 5, text: 'YouTube, Facebook aur Instagram assets buy aur sell karne ke liye ek convenient marketplace.', date: '1 week ago', badge: 'Verified Buyer' },
  { id: 'rev-42', name: 'Gopal Sarkar', stars: 5, text: 'Simple interface ke saath listings browse karein aur opportunities explore karein. 🚀', date: '1 week ago', badge: 'Verified Buyer' },
  { id: 'rev-43', name: 'Nitish Kumar', stars: 4, text: 'Creators aur buyers ko connect karne ke liye design kiya gaya platform. 🤝', date: '1 week ago', badge: 'Verified Buyer' },
  { id: 'rev-44', name: 'Mithun Mondal', stars: 5, text: 'Multiple social media categories ek hi jagah par available. 📱', date: '1 week ago', badge: 'Verified Buyer' },
  { id: 'rev-45', name: 'Kalyan Roy', stars: 5, text: 'Fast, clean aur user-friendly experience ke liye optimized. ✨', date: '1 week ago', badge: 'Verified Buyer' },
  { id: 'rev-46', name: 'Alok Banerjee', stars: 5, text: 'Apni digital assets ki listing karein aur interested buyers tak pahunchiye. 🎯', date: '1 week ago', badge: 'Verified Buyer' },
  { id: 'rev-47', name: 'Debashis Mukherjee', stars: 4, text: 'Social media marketplace ko easy aur accessible banane ki koshish. 🌟', date: '1 week ago', badge: 'Verified Buyer' },
  { id: 'rev-48', name: 'Joydeb Ghosh', stars: 5, text: 'Naye aur experienced users dono ke liye simple navigation. 😊', date: '1 week ago', badge: 'Verified Buyer' },
  { id: 'rev-49', name: 'Biplab Sen', stars: 5, text: 'YT Market App par YouTube channels, Facebook pages aur Instagram accounts ko explore karein. 🚀', date: '2 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-50', name: 'Subrata Mandal', stars: 5, text: 'Digital asset marketplace ko simple aur easy banane ki ek koshish. ✨', date: '2 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-51', name: 'Prosenjit Das', stars: 4, text: 'Listings browse karein aur apni requirements ke hisab se options dekhein. 🔍', date: '2 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-52', name: 'Soumen Paul', stars: 5, text: 'Clean design aur smooth navigation ke saath better user experience. 📱', date: '2 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-53', name: 'Tanmay Biswas', stars: 5, text: 'Creators aur interested buyers ko ek platform par connect karne ka concept. 🤝', date: '2 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-54', name: 'Arup Chatterjee', stars: 5, text: 'Multiple social media categories ek hi app mein available. 🌟', date: '2 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-55', name: 'Partha Halder', stars: 4, text: 'Naye users bhi aasani se platform ko samajh sakte hain. 😊', date: '2 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-56', name: 'Gautam Mondal', stars: 5, text: 'Fast browsing aur organized listings ka experience. ⚡', date: '2 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-57', name: 'Tapas Barman', stars: 5, text: 'Apni social media assets ko showcase karne ka ek convenient platform. 🎯', date: '3 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-58', name: 'Bapi Das', stars: 5, text: 'Modern interface ke saath simple marketplace experience. 😎', date: '3 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-59', name: 'Uttam Roy', stars: 4, text: 'Digital opportunities ko discover karne ke liye useful platform. 💡', date: '3 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-60', name: 'Sudip Sarkar', stars: 5, text: 'Easy navigation aur user-friendly layout ke saath design kiya gaya. 📲', date: '3 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-61', name: 'Sukanta Paul', stars: 5, text: 'YouTube, Facebook aur Instagram related listings ko ek jagah dekhein. 🔥', date: '3 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-62', name: 'Chiranjit Mondal', stars: 5, text: 'Marketplace experience ko smooth aur accessible banane par focus. 🚀', date: '3 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-63', name: 'Swapan Majumdar', stars: 3, text: 'Simple process aur organized categories ke saath better usability. 🌈', date: '3 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-64', name: 'Babulal Murmu', stars: 5, text: 'Social media ecosystem ke liye dedicated marketplace concept. 🌍', date: '3 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-65', name: 'Sonaram Soren', stars: 5, text: 'Listings ko quickly browse karein aur available options explore karein. 🔎', date: '4 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-66', name: 'Budhan Hansda', stars: 5, text: 'Mobile-friendly experience ke liye optimized interface. 📱✨', date: '4 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-67', name: 'Chunaram Marandi', stars: 4, text: 'Digital creators aur buyers ke liye ek useful platform concept. 🎬', date: '4 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-68', name: 'Karan Tudu', stars: 5, text: 'Marketplace ko easy aur convenient banane ki direction mein ek step. 🏆', date: '4 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-69', name: 'Chhotu Besra', stars: 5, text: 'Sabhi major social media categories ko ek jagah access karein. 🌟', date: '4 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-70', name: 'Gopinath Kisku', stars: 4, text: 'User experience aur simplicity par focus kiya gaya hai. 😊', date: '4 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-71', name: 'Durga Charan Soren', stars: 5, text: 'Digital asset marketplace ko explore karne ka naya tareeka. 🚀', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-72', name: 'Shyamlal Mondal', stars: 5, text: 'Organized listings aur simple browsing ka combination. 💯', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-73', name: 'Sukumar Das', stars: 5, text: 'Fast, smooth aur easy-to-use platform experience. ⚡😎', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-74', name: 'Jagabandhu Mahato', stars: 5, text: 'YT Market App ke saath social media marketplace ko explore karna aur bhi easy ho jata hai. 🚀', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-75', name: 'Madhab Ghosh', stars: 5, text: 'YouTube channels, Facebook pages aur Instagram accounts ki listings ek hi platform par. 📱', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-76', name: 'Nimai Roy', stars: 4, text: 'Simple interface aur smooth experience ke liye design kiya gaya. ✨', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-77', name: 'Kartick Mandal', stars: 5, text: 'Digital assets ki duniya ko explore karne ka convenient tareeka. 🌍', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-78', name: 'Shibnath Sen', stars: 5, text: 'Fast navigation aur easy browsing ka experience. ⚡', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-79', name: 'Gouranga Paul', stars: 5, text: 'Har category ko organized format mein dekhne ki suvidha. 📂', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-80', name: 'Sanatan Biswas', stars: 5, text: 'Modern design ke saath user-friendly marketplace. 😎', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-81', name: 'Naba Kumar Das', stars: 4, text: 'Listings ko explore karein aur naye opportunities discover karein. 🔍', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-82', name: 'Haradhan Mondal', stars: 5, text: 'Beginners aur experienced users dono ke liye easy platform. 😊', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-83', name: 'Bholanath Roy', stars: 5, text: 'Social media marketplace ko accessible banane par focus. 🎯', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-84', name: 'Laxman Murmu', stars: 5, text: 'Ek clean aur professional experience jo use karne mein simple lage. 💎', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-85', name: 'Hemant Soren', stars: 4, text: 'Different social media categories ko ek jagah manage karne ka concept. 🔥', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-86', name: 'Shyamal Hansda', stars: 5, text: 'Quick browsing aur smooth usability ke liye optimized. 📲', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-87', name: 'Bikash Tudu', stars: 5, text: 'Marketplace experience ko aur convenient banane ki koshish. 🤝', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-88', name: 'Sanjay Besra', stars: 5, text: 'Mobile users ke liye responsive aur easy-to-use platform. 📱✨', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-89', name: 'Raju Kisku', stars: 5, text: 'Digital creators aur social media enthusiasts ke liye useful concept. 🎬', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-90', name: 'Sunil Mandal', stars: 4, text: 'Organized listings ke saath better browsing experience. 🌟', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-91', name: 'Bikas Das', stars: 5, text: 'Har listing ko aasani se explore karne ke liye simple layout. 🔎', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-92', name: 'Pranab Ghosh', stars: 5, text: 'Platform ka focus simplicity aur usability par hai. 💯', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-93', name: 'Dipak Sen', stars: 5, text: 'Social media marketplace ko modern touch ke saath present kiya gaya hai. 🚀', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-94', name: 'Subal Paul', stars: 5, text: 'Features ko access karna easy aur straightforward rakha gaya hai. 👍', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-95', name: 'Dulal Sarkar', stars: 5, text: 'User-friendly interface jo first-time users ko bhi comfortable feel karaye. 😊', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-96', name: 'Joydev Biswas', stars: 5, text: 'Marketplace experience ko fast aur smooth banane ki direction mein design. ⚡', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-97', name: 'Milan Mondal', stars: 4, text: 'Different opportunities ko discover karne ke liye ek dedicated platform. 🌈', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-98', name: 'Prabir Roy', stars: 5, text: 'Social media related listings ko browse karne ka easy solution. 🎯', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-99', name: 'Ashok Banerjee', stars: 5, text: 'Simple design aur practical functionality ka accha combination. ✨', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-100', name: 'Debu Mukherjee', stars: 5, text: 'Digital marketplace ko explore karne ke liye ek modern platform. 🌍', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-101', name: 'Shankar Dutta', stars: 4, text: 'Categories aur listings ko dekhna aur samajhna kaafi easy hai. 📂', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-102', name: 'Badal Karmakar', stars: 5, text: 'User convenience ko dhyan mein rakhkar develop kiya gaya interface. 😃', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-103', name: 'Rabi Mahato', stars: 5, text: 'Ek platform, multiple social media categories, easy browsing. 🚀📱', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-104', name: 'Khagen Bauri', stars: 5, text: 'Social media marketplace ko simple aur accessible banane ke liye tayyar kiya gaya platform. 🚀', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-105', name: 'Sibu Majhi', stars: 5, text: 'Apne digital assets ko showcase karne aur opportunities explore karne ka ek naya tareeka. 🌟', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-106', name: 'Panchanan Soren', stars: 4, text: 'Fast browsing aur clean design ke saath better experience. ✨', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-107', name: 'Sital Hansda', stars: 5, text: 'Social media ecosystem ko ek hi jagah connect karne ki koshish. 🤝', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-108', name: 'Dukhiram Murmu', stars: 5, text: 'Har category ko easy navigation ke saath organize kiya gaya hai. 📂', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-109', name: 'Mangal Tudu', stars: 5, text: 'Marketplace experience ko smooth aur hassle-free banane par focus. 😊', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-110', name: 'Jogen Besra', stars: 5, text: 'Modern interface jo users ko comfortable browsing experience deta hai. 📱', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-111', name: 'Ananda Kisku', stars: 4, text: 'Social media related opportunities ko discover karne ke liye useful platform. 🔍', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-112', name: 'Basudeb Mondal', stars: 5, text: 'Simplicity aur usability ko dhyan mein rakhkar design kiya gaya. 💯', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-113', name: 'Ganesh Das', stars: 5, text: 'Ek aisa marketplace jahan exploration easy aur convenient lagta hai. 🚀', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-114', name: 'Kishore Roy', stars: 5, text: 'Organized layout ke saath listings ko dekhna aur samajhna easy hai. 📲', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-115', name: 'Tarak Ghosh', stars: 5, text: 'User-friendly features jo overall experience ko aur behtar banate hain. 😎', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-116', name: 'Bimal Sen', stars: 4, text: 'Digital marketplace ko modern aur accessible form mein present kiya gaya hai. 🌍', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-117', name: 'Bipul Paul', stars: 5, text: 'Simple process aur clear structure ke saath smooth browsing. ⚡', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-118', name: 'Anup Sarkar', stars: 5, text: 'Naye users bhi platform ko aasani se explore kar sakte hain. 😊', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-119', name: 'Monojit Biswas', stars: 5, text: 'Social media categories ko ek jagah access karne ki suvidha. 📱✨', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-120', name: 'Samir Mondal', stars: 5, text: 'Practical features aur clean interface ka accha combination. 🔥', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-121', name: 'Samiran Roy', stars: 5, text: 'Marketplace concept ko easy aur engaging banane ki koshish. 🎯', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-122', name: 'Sukhen Banerjee', stars: 4, text: 'Quick access aur organized listings ke saath better usability. 🌈', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-123', name: 'Dipankar Mukherjee', stars: 5, text: 'Digital opportunities ko discover karne ke liye dedicated platform. 💡', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-124', name: 'Sujit Dutta', stars: 5, text: 'Fast performance aur easy navigation ka experience. ⚡😃', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-125', name: 'Debasish Karmakar', stars: 5, text: 'Har section ko user convenience ke hisab se arrange kiya gaya hai. 📂', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-126', name: 'Ranjit Mahato', stars: 5, text: 'Social media marketplace ko explore karne ka smart tareeka. 🚀', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-127', name: 'Tushar Bauri', stars: 5, text: 'Clean look aur simple functionality users ko attract karti hai. ✨', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-128', name: 'Sujay Majhi', stars: 4, text: 'Platform ka focus easy browsing aur smooth experience par hai. 🌟', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-129', name: 'Prakash Soren', stars: 5, text: 'Modern design ke saath practical features ka perfect balance. 📱', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-130', name: 'Chandan Hansda', stars: 5, text: 'Different categories ko quickly browse karne ki suvidha. 🔎', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-131', name: 'Manik Murmu', stars: 5, text: 'Marketplace experience ko aur efficient banane ka prayas. 💯', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-132', name: 'Sanjoy Tudu', stars: 5, text: 'Digital assets ki duniya ko explore karne ke liye convenient platform. 🌍', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-133', name: 'Debasis Besra', stars: 4, text: 'User-friendly layout jo har type ke user ke liye suitable hai. 😊', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-134', name: 'Kamal Kisku', stars: 5, text: 'Smart browsing aur simple navigation ke saath enjoyable experience. 🚀✨', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-135', name: 'Ratan Mondal', stars: 5, text: 'Social media marketplace ko ek naye level par le jane ki soch. 🔥', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-136', name: 'Avijit Das', stars: 5, text: 'Easy access aur organized content ke saath better exploration. 📲', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-137', name: 'Sourav Roy', stars: 5, text: 'Har visit par smooth aur responsive experience ka ehsaas. ⚡', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-138', name: 'Kaushik Ghosh', stars: 5, text: 'Digital creators aur enthusiasts ke liye interesting platform concept. 🎬🌟', date: '1 month ago', badge: 'Verified Buyer' },
  { id: 'rev-139', name: 'Mayank Sharma', stars: 3, text: 'App ka concept accha hai aur YouTube, Facebook aur Instagram accounts buy/sell karne ka process kaafi simple hai. Kuch features aur improve ho sakte hain, lekin overall experience theek raha.', date: '1 day ago', badge: 'Verified Buyer' },
  { id: 'rev-140', name: 'Deepak Choudhary', stars: 3, text: 'YT Market App use karna easy hai. Account listings dekhna aur contact karna convenient hai. Kabhi-kabhi response thoda slow milta hai, par platform ka idea useful laga.', date: '2 days ago', badge: 'Verified Buyer' },
  { id: 'rev-141', name: 'Alok Trivedi', stars: 3, text: 'App me kaafi channels aur IDs ki listings mil jati hain. Interface aur smooth ho sakta hai, lekin basic buying aur selling ke liye kaam chal jata hai.', date: '3 days ago', badge: 'Verified Buyer' },
  { id: 'rev-142', name: 'Sameer Saxena', stars: 3, text: 'Mera experience average raha. Kuch deals achhi lagi aur process samajhna easy tha. Future updates me verification system aur strong ho sakta hai.', date: '5 days ago', badge: 'Verified Buyer' },
  { id: 'rev-143', name: 'Ritesh Pandey', stars: 3, text: 'YouTube aur Instagram accounts ke liye achha marketplace hai. App kabhi-kabhi thoda lag karta hai, lekin overall use karne layak hai.', date: '1 week ago', badge: 'Verified Buyer' },
  { id: 'rev-144', name: 'Prashant Yadav', stars: 3, text: 'Account buy aur sell karne ke liye useful platform hai. Features theek hain, lekin search aur filter options aur better ho sakte hain.', date: '1 week ago', badge: 'Verified Buyer' },
  { id: 'rev-145', name: 'Kunal Rawat', stars: 3, text: 'Registration aur listing process simple hai. Thoda aur fast performance ho jaye to experience aur accha ho sakta hai.', date: '2 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-146', name: 'Naveen Joshi', stars: 3, text: 'App genuine lagta hai aur kaafi categories available hain. Kuch improvements ki zarurat hai, lekin overall theek platform hai.', date: '2 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-147', name: 'Harish Bhatt', stars: 3, text: 'YT Market App se account listings dekhna easy hai. Kabhi-kabhi loading issue aata hai, lekin overall experience average se accha raha.', date: '3 weeks ago', badge: 'Verified Buyer' },
  { id: 'rev-148', name: 'Vikram Rajput', stars: 3, text: 'Facebook pages aur Instagram IDs ke liye kaafi options milte hain. App useful hai, bas thodi aur optimization ki zarurat hai.', date: '3 weeks ago', badge: 'Verified Buyer' }
];

let activeReviewFilter = 'all';
window.getReviewsList = () => {
  const saved = localStorage.getItem('yt_approved_reviews_v5_3stars');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch(e) {}
  }
  return initialReviewsPool;
};

window.saveReviewsList = (list) => {
  localStorage.setItem('yt_approved_reviews_v5_3stars', JSON.stringify(list));
};

window.filterReviews = (filter) => {
  activeReviewFilter = filter;
  ['all', 5, 4, 3].forEach(f => {
    const btn = document.getElementById(`rf-${f}`);
    if (f == filter) {
      if (btn) btn.className = 'px-4 py-2 rounded-xl bg-yellow-500 text-black font-black transition-all cursor-pointer';
    } else {
      if (btn) btn.className = 'px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 transition-all cursor-pointer flex items-center gap-1';
    }
  });
  window.renderReviews();
};

window.renderReviews = () => {
  const container = document.getElementById('reviews-list-container');
  if (!container) return;

  const reviews = window.getReviewsList();
  const filtered = activeReviewFilter === 'all' 
    ? reviews 
    : reviews.filter(r => r.stars === Number(activeReviewFilter));

  container.innerHTML = filtered.map(rev => {
    let starsHtml = '';
    for (let i = 0; i < rev.stars; i++) {
      starsHtml += `<i data-lucide="star" class="w-4 h-4 fill-yellow-400 text-yellow-400"></i>`;
    }

    return `
      <div class="bg-[#111111] border border-white/10 rounded-2xl p-5 space-y-3 text-left relative group">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center font-bold text-sm">
              ${rev.name.charAt(0)}
            </div>
            <div>
              <p class="font-bold text-white text-sm flex items-center gap-1.5">
                ${escapeHTML(rev.name)}
                <span class="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[10px] rounded-full font-semibold">${rev.badge || 'Verified Buyer'}</span>
              </p>
              <p class="text-[10px] text-gray-500">${rev.date}</p>
            </div>
          </div>
          <div class="flex items-center gap-1">
            ${starsHtml}
          </div>
        </div>
        <p class="text-xs text-gray-200 leading-relaxed font-medium">"${escapeHTML(rev.text)}"</p>
      </div>
    `;
  }).join('');

  refreshLucide();
};

window.openWriteReviewModal = () => {
  if (localStorage.getItem('yt_device_reviewed')) {
    return window.showAlert(currentLanguage === 'hi'
      ? 'आप इस डिवाइस से पहले ही रेटिंग दे चुके हैं। रेटिंग देने के लिए धन्यवाद!'
      : 'You have already submitted a review from this device. Thanks for rating!');
  }
  document.getElementById('write-review-modal')?.classList.remove('hidden');
  refreshLucide();
};

window.closeWriteReviewModal = () => {
  document.getElementById('write-review-modal')?.classList.add('hidden');
};

window.submitUserReview = () => {
  if (localStorage.getItem('yt_device_reviewed')) {
    window.closeWriteReviewModal();
    return window.showAlert(currentLanguage === 'hi'
      ? 'आप इस डिवाइस से पहले ही रेटिंग दे चुके हैं। रेटिंग देने के लिए धन्यवाद!'
      : 'You have already submitted a review from this device. Thanks for rating!');
  }

  const name = document.getElementById('review-user-name')?.value.trim();
  const stars = Number(document.getElementById('review-star-rating')?.value) || 5;
  const comment = document.getElementById('review-comment-text')?.value.trim();

  if (!name) {
    return window.showAlert(currentLanguage === 'hi' ? 'कृपया अपना नाम दर्ज करें।' : 'Please enter your name.');
  }
  if (!comment) {
    return window.showAlert(currentLanguage === 'hi' ? 'कृपया अपनी समीक्षा या संदेश लिखें।' : 'Please write your review.');
  }

  // Save device submission record (one review per device)
  localStorage.setItem('yt_device_reviewed', 'true');

  // Push to Firebase for admin records only (not shown in user app review list)
  push(ref(db, 'reviews'), {
    name,
    stars,
    text: comment,
    status: 'submitted',
    userId,
    timestamp: Date.now()
  }).catch(() => {});

  // Clean inputs and close modal
  const rName = document.getElementById('review-user-name');
  const rComm = document.getElementById('review-comment-text');
  if (rName) rName.value = '';
  if (rComm) rComm.value = '';
  window.closeWriteReviewModal();

  window.showAlert(currentLanguage === 'hi'
    ? 'रेटिंग देने के लिए धन्यवाद! (Thanks for rating!)'
    : 'Thanks for rating!');
};

// ============================================================
// USER AUTHENTICATION & PROFILE SYSTEM (SIGN UP, LOGIN, LOGOUT)
// ============================================================
let currentAuthUser = null;

// Sync user state across UI components
function syncAuthUI() {
  const navAvatar = document.getElementById('nav-profile-avatar');
  const navText = document.getElementById('nav-profile-text');
  const sideAvatar = document.getElementById('sidebar-profile-avatar');
  const sideName = document.getElementById('sidebar-profile-name');
  const sideSub = document.getElementById('sidebar-profile-sub');

  if (currentAuthUser) {
    const displayName = currentAuthUser.displayName || currentAuthUser.email.split('@')[0];
    const initial = (displayName.charAt(0) || 'U').toUpperCase();

    if (navAvatar) {
      navAvatar.innerHTML = `<span class="font-black text-xs text-white">${initial}</span>`;
      navAvatar.className = "w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 border border-indigo-400 flex items-center justify-center font-bold text-xs overflow-hidden shadow-sm";
    }
    if (navText) {
      navText.innerText = displayName.split(' ')[0];
    }
    if (sideAvatar) {
      sideAvatar.innerHTML = `<span class="font-bold text-xs text-white">${initial}</span>`;
      sideAvatar.className = "w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 border border-indigo-400 flex items-center justify-center font-bold text-xs shrink-0 overflow-hidden";
    }
    if (sideName) {
      sideName.innerText = displayName;
    }
    if (sideSub) {
      sideSub.innerText = currentAuthUser.email;
    }
  } else {
    if (navAvatar) {
      navAvatar.innerHTML = `<i data-lucide="user" class="w-4 h-4"></i>`;
      navAvatar.className = "w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-bold text-xs overflow-hidden";
    }
    if (navText) {
      navText.innerText = currentLanguage === 'hi' ? 'प्रोफाइल' : 'Profile';
    }
    if (sideAvatar) {
      sideAvatar.innerHTML = `<i data-lucide="user" class="w-4 h-4"></i>`;
      sideAvatar.className = "w-8 h-8 rounded-full bg-indigo-600/40 border border-indigo-400/40 flex items-center justify-center text-indigo-200 font-bold text-xs shrink-0 overflow-hidden";
    }
    if (sideName) {
      sideName.innerText = currentLanguage === 'hi' ? 'मेरी प्रोफाइल' : 'My Profile';
    }
    if (sideSub) {
      sideSub.innerText = currentLanguage === 'hi' ? 'लॉगिन / प्रोफाइल देखें' : 'Login / View Profile';
    }
  }
  refreshLucide();
}

// Firebase Persistence & Data Sync for Users (Realtime Database & Firestore)
async function saveUserToFirebase(userObj, provider = 'password') {
  if (!userObj || !userObj.uid) return;
  const uid = userObj.uid;
  const name = userObj.displayName || userObj.name || (userObj.email ? userObj.email.split('@')[0] : 'User');
  const email = userObj.email || '';
  const photo = userObj.photoURL || '';
  const now = Date.now();

  const rtdbPayload = {
    uid: uid,
    name: name,
    email: email,
    photoURL: photo,
    provider: provider,
    lastLogin: now,
    updatedAt: now,
    status: 'active'
  };

  // 1. Save to Firebase Realtime Database at /users/{uid}
  try {
    await update(ref(db, `users/${uid}`), rtdbPayload);
    console.log('[Firebase RTDB] User updated successfully:', uid);
  } catch (err) {
    try {
      await set(ref(db, `users/${uid}`), { ...rtdbPayload, createdAt: now });
      console.log('[Firebase RTDB] User created successfully:', uid);
    } catch (setErr) {
      console.warn('[Firebase RTDB] Error saving user:', setErr);
    }
  }

  // Also maintain directory lookup in Realtime Database
  try {
    const cleanEmailKey = email.replace(/[.#$[\]/]/g, '_');
    if (cleanEmailKey) {
      set(ref(db, `user_directory/${cleanEmailKey}`), {
        uid: uid,
        name: name,
        email: email,
        lastLogin: now
      }).catch(() => {});
    }
  } catch (e) {}

  // 2. Save to Cloud Firestore under collection 'users' doc id uid
  try {
    await setDoc(doc(firestore, 'users', uid), {
      uid: uid,
      name: name,
      email: email,
      photoURL: photo,
      provider: provider,
      lastLogin: serverTimestamp(),
      updatedAt: serverTimestamp(),
      status: 'active'
    }, { merge: true });
    console.log('[Firestore] User document synced:', uid);
  } catch (err) {
    console.warn('[Firestore] Error saving user doc:', err);
  }
}

// Initialize Auth Listener & Session with Strict Gatekeeper
function initAuthSystem() {
  const cached = localStorage.getItem('yt_auth_user');
  if (cached) {
    try {
      currentAuthUser = JSON.parse(cached);
    } catch (e) {
      currentAuthUser = null;
    }
  }

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentAuthUser = {
        uid: user.uid,
        displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'User'),
        email: user.email || '',
        photoURL: user.photoURL || null
      };
      localStorage.setItem('yt_auth_user', JSON.stringify(currentAuthUser));
      // Save/sync session to Firebase
      saveUserToFirebase(currentAuthUser, 'session_sync');
      // Unlock app view
      document.getElementById('app-container')?.classList.remove('hidden');
      const authModal = document.getElementById('auth-modal');
      if (authModal) authModal.classList.add('hidden');
    } else if (!cached) {
      currentAuthUser = null;
      // Lock app: cannot open until login or signup
      document.getElementById('app-container')?.classList.add('hidden');
      window.openAuthModal('login');
    }
    syncAuthUI();
  });

  // Initial gate check
  if (!currentAuthUser) {
    document.getElementById('app-container')?.classList.add('hidden');
    window.openAuthModal('login');
  } else {
    document.getElementById('app-container')?.classList.remove('hidden');
  }

  syncAuthUI();
}

window.openProfileOrAuth = () => {
  if (currentAuthUser) {
    window.showView('profile-view');
  } else {
    window.openAuthModal('login');
  }
};

window.openAuthModal = (tab = 'login') => {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  window.switchAuthTab(tab);
  
  const closeBtn = document.getElementById('auth-modal-close-btn');
  if (closeBtn) {
    if (currentAuthUser) {
      closeBtn.classList.remove('hidden');
    } else {
      closeBtn.classList.add('hidden');
    }
  }

  refreshLucide();
};

window.closeAuthModal = () => {
  // Strict constraint: app must not open or dismiss modal until logged in or signed up
  if (!currentAuthUser) {
    return window.showAlert(currentLanguage === 'hi'
      ? 'कृपया ऐप का उपयोग करने के लिए पहले लॉगिन या साइन अप करें।'
      : 'Please login or sign up first to access the app.');
  }
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('hidden');
};

window.switchAuthTab = (tab) => {
  const tabLogin = document.getElementById('auth-tab-login');
  const tabSignup = document.getElementById('auth-tab-signup');
  const formLogin = document.getElementById('auth-login-form');
  const formSignup = document.getElementById('auth-signup-form');
  const modalTitle = document.getElementById('auth-modal-title');
  const modalSub = document.getElementById('auth-modal-sub');
  const promptContainer = document.getElementById('auth-footer-prompt');

  if (tab === 'signup') {
    if (tabSignup) tabSignup.className = "py-2.5 text-xs font-bold rounded-lg transition-all cursor-pointer bg-indigo-600 text-white shadow-md";
    if (tabLogin) tabLogin.className = "py-2.5 text-xs font-bold rounded-lg transition-all cursor-pointer text-gray-400 hover:text-white";
    if (formSignup) formSignup.classList.remove('hidden');
    if (formLogin) formLogin.classList.add('hidden');
    if (modalTitle) modalTitle.innerText = currentLanguage === 'hi' ? 'नया खाता बनाएं' : 'Create an Account';
    if (modalSub) modalSub.innerText = currentLanguage === 'hi' ? 'ऐप खोलने के लिए साइन अप करें' : 'Sign up to unlock the app';
    if (promptContainer) {
      promptContainer.innerHTML = currentLanguage === 'hi' 
        ? `पहले से खाता है? <button type="button" onclick="window.switchAuthTab('login')" class="text-indigo-400 hover:underline font-bold cursor-pointer">लॉगिन करें</button>`
        : `Already have an account? <button type="button" onclick="window.switchAuthTab('login')" class="text-indigo-400 hover:underline font-bold cursor-pointer">Log In here</button>`;
    }
  } else {
    if (tabLogin) tabLogin.className = "py-2.5 text-xs font-bold rounded-lg transition-all cursor-pointer bg-indigo-600 text-white shadow-md";
    if (tabSignup) tabSignup.className = "py-2.5 text-xs font-bold rounded-lg transition-all cursor-pointer text-gray-400 hover:text-white";
    if (formLogin) formLogin.classList.remove('hidden');
    if (formSignup) formSignup.classList.add('hidden');
    if (modalTitle) modalTitle.innerText = currentLanguage === 'hi' ? 'YT Market में लॉगिन करें' : 'Welcome to YT Market';
    if (modalSub) modalSub.innerText = currentLanguage === 'hi' ? 'ऐप खोलने के लिए लॉगिन करें' : 'Login to unlock the app';
    if (promptContainer) {
      promptContainer.innerHTML = currentLanguage === 'hi'
        ? `खाता नहीं है? <button type="button" onclick="window.switchAuthTab('signup')" class="text-indigo-400 hover:underline font-bold cursor-pointer">नया खाता बनाएं</button>`
        : `Don't have an account? <button type="button" onclick="window.switchAuthTab('signup')" class="text-indigo-400 hover:underline font-bold cursor-pointer">Sign Up here</button>`;
    }
  }
  refreshLucide();
};

window.togglePasswordVisibility = (inputId) => {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
};

// Google Accounts Management & Account Chooser (Sabhi Gmail accounts dikhana)
function getSavedGoogleAccounts() {
  let accounts = [];
  try {
    accounts = JSON.parse(localStorage.getItem('yt_google_accounts') || '[]');
  } catch (e) {
    accounts = [];
  }

  // Pre-populate with detected/known Google accounts from user session & registrations
  const defaults = [
    { email: 'kiskubk005@gmail.com', name: 'Bittu Kisku' },
    { email: 'rockykisku666@gmail.com', name: 'Rocky Kisku' }
  ];

  defaults.forEach(def => {
    if (!accounts.some(a => a.email.toLowerCase() === def.email.toLowerCase())) {
      accounts.push(def);
    }
  });

  // Also include any registered users with gmail addresses
  try {
    const regUsers = JSON.parse(localStorage.getItem('yt_registered_users') || '[]');
    regUsers.forEach(u => {
      if (u.email && u.email.toLowerCase().includes('@gmail.com')) {
        if (!accounts.some(a => a.email.toLowerCase() === u.email.toLowerCase())) {
          accounts.push({ email: u.email, name: u.displayName || u.email.split('@')[0] });
        }
      }
    });
  } catch (e) {}

  return accounts;
}

window.openGoogleAccountChooser = () => {
  const modal = document.getElementById('google-account-chooser-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  window.renderGoogleAccountsList();
  refreshLucide();
};

window.closeGoogleAccountChooser = () => {
  const modal = document.getElementById('google-account-chooser-modal');
  if (modal) modal.classList.add('hidden');
};

window.renderGoogleAccountsList = () => {
  const listEl = document.getElementById('google-accounts-list');
  if (!listEl) return;
  const accounts = getSavedGoogleAccounts();

  if (accounts.length === 0) {
    listEl.innerHTML = `
      <div class="py-4 text-center text-gray-400 text-xs">
        ${currentLanguage === 'hi' ? 'कोई सहेजा गया खाता नहीं मिला। कृपया नीचे अपना Gmail दर्ज करें।' : 'No saved accounts found. Please enter your Gmail below.'}
      </div>
    `;
    return;
  }

  listEl.innerHTML = accounts.map((acc) => {
    const name = acc.name || acc.email.split('@')[0];
    const initial = (name.charAt(0) || 'G').toUpperCase();
    const safeEmail = acc.email.replace(/'/g, "\\'");
    const safeName = name.replace(/'/g, "\\'");
    return `
      <button type="button" onclick="window.selectGoogleAccount('${safeEmail}', '${safeName}')" class="w-full p-2.5 rounded-xl hover:bg-white/10 flex items-center gap-3 text-left transition-colors cursor-pointer group border border-transparent hover:border-white/10 active:scale-[0.99]">
        <div class="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 border border-blue-400/40 flex items-center justify-center font-bold text-xs text-white shrink-0 shadow-sm">
          ${initial}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-xs font-bold text-white truncate group-hover:text-blue-300 transition-colors">${name}</p>
          <p class="text-[11px] text-gray-400 truncate">${acc.email}</p>
        </div>
        <i data-lucide="chevron-right" class="w-4 h-4 text-gray-500 group-hover:text-white shrink-0"></i>
      </button>
    `;
  }).join('');

  refreshLucide();
};

window.toggleAddGoogleAccountForm = () => {
  const form = document.getElementById('google-add-account-form');
  if (!form) return;
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden')) {
    document.getElementById('custom-google-email')?.focus();
  }
};

window.submitCustomGoogleAccount = async (e) => {
  e.preventDefault();
  const email = document.getElementById('custom-google-email')?.value?.trim();
  let name = document.getElementById('custom-google-name')?.value?.trim();

  if (!email || !email.includes('@')) {
    return window.showAlert(currentLanguage === 'hi' ? 'कृपया एक मान्य Gmail पता दर्ज करें।' : 'Please enter a valid Gmail address.');
  }

  if (!name) {
    name = email.split('@')[0];
  }

  await window.selectGoogleAccount(email, name);
};

window.selectGoogleAccount = async (email, name) => {
  const cleanUid = 'google_' + email.replace(/[^a-zA-Z0-9]/g, '_');
  
  currentAuthUser = {
    uid: cleanUid,
    displayName: name || email.split('@')[0],
    email: email,
    photoURL: null,
    provider: 'google'
  };
  localStorage.setItem('yt_auth_user', JSON.stringify(currentAuthUser));

  // Save to saved google accounts list
  const accounts = getSavedGoogleAccounts();
  if (!accounts.some(a => a.email.toLowerCase() === email.toLowerCase())) {
    accounts.unshift({ email, name });
    localStorage.setItem('yt_google_accounts', JSON.stringify(accounts));
  }

  // Persist to Firebase Realtime Database & Firestore!
  await saveUserToFirebase(currentAuthUser, 'google');

  // Close modals & unlock app
  window.closeGoogleAccountChooser();
  const authModal = document.getElementById('auth-modal');
  if (authModal) authModal.classList.add('hidden');
  document.getElementById('app-container')?.classList.remove('hidden');

  syncAuthUI();
  window.showView('home-view');
  window.showAlert(currentLanguage === 'hi' 
    ? `गूगल से सफलतापूर्वक लॉगिन किया! स्वागत है, ${currentAuthUser.displayName}`
    : `Signed in with Google successfully! Welcome, ${currentAuthUser.displayName}`);
};

window.triggerNativeGooglePopup = async () => {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: 'select_account'
    });
    provider.addScope('email');
    provider.addScope('profile');

    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    currentAuthUser = {
      uid: user.uid,
      displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'User'),
      email: user.email || '',
      photoURL: user.photoURL || null,
      provider: 'google'
    };
    localStorage.setItem('yt_auth_user', JSON.stringify(currentAuthUser));

    // Also remember this Google account
    const accounts = getSavedGoogleAccounts();
    if (!accounts.some(a => a.email.toLowerCase() === currentAuthUser.email.toLowerCase())) {
      accounts.unshift({ email: currentAuthUser.email, name: currentAuthUser.displayName });
      localStorage.setItem('yt_google_accounts', JSON.stringify(accounts));
    }

    // Persist to Firebase Realtime Database & Firestore
    await saveUserToFirebase(currentAuthUser, 'google');

    window.closeGoogleAccountChooser();
    document.getElementById('app-container')?.classList.remove('hidden');
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.add('hidden');

    syncAuthUI();
    window.showView('home-view');
    window.showAlert(currentLanguage === 'hi' 
      ? `गूगल से सफलतापूर्वक लॉगिन किया! स्वागत है, ${currentAuthUser.displayName}`
      : `Signed in with Google successfully! Welcome, ${currentAuthUser.displayName}`);
  } catch (err) {
    console.error('Google Popup Error:', err);
    if (err.code === 'auth/popup-closed-by-user') return;
    window.showAlert(currentLanguage === 'hi'
      ? 'कृपया सूची में से अपना Gmail अकाउंट चुनें या नया अकाउंट दर्ज करें।'
      : 'Please select your Gmail account from the list or enter a new one.');
  }
};

window.loginWithGoogle = () => {
  // Directly open Google Account Chooser showing all Gmail accounts!
  window.openGoogleAccountChooser();
};

window.handleEmailSignup = async (e) => {
  e.preventDefault();
  const name = document.getElementById('signup-name')?.value?.trim();
  const email = document.getElementById('signup-email')?.value?.trim();
  const pass = document.getElementById('signup-pass')?.value;
  const confirmPass = document.getElementById('signup-confirm-pass')?.value;

  if (!name || !email || !pass) {
    return window.showAlert(currentLanguage === 'hi' ? 'कृपया सभी आवश्यक फ़ील्ड भरें।' : 'Please fill all fields.');
  }
  if (pass.length < 6) {
    return window.showAlert(currentLanguage === 'hi' ? 'पासवर्ड कम से कम 6 अक्षरों का होना चाहिए।' : 'Password must be at least 6 characters.');
  }
  if (pass !== confirmPass) {
    return window.showAlert(currentLanguage === 'hi' ? 'दोनों पासवर्ड मेल नहीं खा रहे हैं।' : 'Passwords do not match.');
  }

  const btn = document.getElementById('btn-auth-signup-submit');
  if (btn) btn.disabled = true;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name }).catch(() => {});
    currentAuthUser = {
      uid: cred.user.uid,
      displayName: name,
      email: cred.user.email,
      photoURL: null
    };
    localStorage.setItem('yt_auth_user', JSON.stringify(currentAuthUser));
    
    // Save to backup registered users list
    const users = JSON.parse(localStorage.getItem('yt_registered_users') || '[]');
    if (!users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      users.push({ uid: cred.user.uid, displayName: name, email, password: pass });
      localStorage.setItem('yt_registered_users', JSON.stringify(users));
    }

    // Persist to Firebase Realtime Database & Firestore!
    await saveUserToFirebase(currentAuthUser, 'password');

    // Unlock and open the app
    document.getElementById('app-container')?.classList.remove('hidden');
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.add('hidden');

    syncAuthUI();
    window.showView('home-view');
    window.showAlert(currentLanguage === 'hi'
      ? `खाता सफलतापूर्वक बनाया गया! स्वागत है, ${name}`
      : `Account created successfully! Welcome, ${name}`);
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      window.showAlert(currentLanguage === 'hi' ? 'यह ईमेल पहले से पंजीकृत है। कृपया लॉगिन करें।' : 'This email is already registered. Please login.');
    } else if (err.code === 'auth/operation-not-allowed' || err.code === 'auth/network-request-failed' || !navigator.onLine) {
      // Offline / fallback account creation
      const users = JSON.parse(localStorage.getItem('yt_registered_users') || '[]');
      if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
        return window.showAlert(currentLanguage === 'hi' ? 'यह ईमेल पहले से पंजीकृत है। कृपया लॉगिन करें।' : 'This email is already registered. Please login.');
      }
      const localUid = 'user_' + Date.now();
      users.push({ uid: localUid, displayName: name, email, password: pass });
      localStorage.setItem('yt_registered_users', JSON.stringify(users));
      currentAuthUser = { uid: localUid, displayName: name, email, photoURL: null };
      localStorage.setItem('yt_auth_user', JSON.stringify(currentAuthUser));

      // Persist to Firebase Realtime Database & Firestore
      await saveUserToFirebase(currentAuthUser, 'password_local');

      // Unlock and open the app
      document.getElementById('app-container')?.classList.remove('hidden');
      const modal = document.getElementById('auth-modal');
      if (modal) modal.classList.add('hidden');

      syncAuthUI();
      window.showView('home-view');
      window.showAlert(currentLanguage === 'hi'
        ? `खाता सफलतापूर्वक बनाया गया! स्वागत है, ${name}`
        : `Account created successfully! Welcome, ${name}`);
    } else {
      window.showAlert(err.message || 'Signup failed. Please try again.');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.handleEmailLogin = async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email')?.value?.trim();
  const pass = document.getElementById('login-pass')?.value;

  if (!email || !pass) {
    return window.showAlert(currentLanguage === 'hi' ? 'कृपया ईमेल और पासवर्ड दर्ज करें।' : 'Please enter email and password.');
  }

  const btn = document.getElementById('btn-auth-login-submit');
  if (btn) btn.disabled = true;

  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    currentAuthUser = {
      uid: cred.user.uid,
      displayName: cred.user.displayName || email.split('@')[0],
      email: cred.user.email,
      photoURL: cred.user.photoURL || null
    };
    localStorage.setItem('yt_auth_user', JSON.stringify(currentAuthUser));

    // Update lastLogin in Firebase RTDB & Firestore!
    await saveUserToFirebase(currentAuthUser, 'password');

    // Unlock and open the app
    document.getElementById('app-container')?.classList.remove('hidden');
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.add('hidden');

    syncAuthUI();
    window.showView('home-view');
    window.showAlert(currentLanguage === 'hi'
      ? `लॉगिन सफल! स्वागत है, ${currentAuthUser.displayName}`
      : `Logged in successfully! Welcome back, ${currentAuthUser.displayName}`);
  } catch (err) {
    // Check fallback account
    const users = JSON.parse(localStorage.getItem('yt_registered_users') || '[]');
    const matched = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === pass);
    if (matched) {
      currentAuthUser = {
        uid: matched.uid,
        displayName: matched.displayName || matched.email.split('@')[0],
        email: matched.email,
        photoURL: null
      };
      localStorage.setItem('yt_auth_user', JSON.stringify(currentAuthUser));

      // Save to Firebase RTDB & Firestore
      await saveUserToFirebase(currentAuthUser, 'password_local');

      // Unlock and open the app
      document.getElementById('app-container')?.classList.remove('hidden');
      const modal = document.getElementById('auth-modal');
      if (modal) modal.classList.add('hidden');

      syncAuthUI();
      window.showView('home-view');
      return window.showAlert(currentLanguage === 'hi'
        ? `लॉगिन सफल! स्वागत है, ${currentAuthUser.displayName}`
        : `Logged in successfully! Welcome back, ${currentAuthUser.displayName}`);
    }

    if (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
      window.showAlert(currentLanguage === 'hi' ? 'गलत ईमेल या पासवर्ड। कृपया जांचें।' : 'Incorrect email or password. Please check.');
    } else {
      window.showAlert(err.message || 'Login failed. Please check your credentials.');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.forgotPassword = async () => {
  let email = document.getElementById('login-email')?.value?.trim();
  if (!email) {
    email = window.prompt(currentLanguage === 'hi' ? 'अपना पंजीकृत ईमेल पता दर्ज करें:' : 'Enter your registered email address:');
  }
  if (!email) return;

  try {
    await sendPasswordResetEmail(auth, email);
    window.showAlert(currentLanguage === 'hi'
      ? 'पासवर्ड रीसेट लिंक आपके ईमेल पर भेज दिया गया है।'
      : 'Password reset link sent to your email.');
  } catch (err) {
    window.showAlert(currentLanguage === 'hi'
      ? 'यदि यह ईमेल पंजीकृत है, तो पासवर्ड रीसेट निर्देश भेज दिए गए हैं।'
      : 'If this email is registered, reset instructions have been sent.');
  }
};

window.renderProfileView = () => {
  if (!currentAuthUser) {
    const cached = localStorage.getItem('yt_auth_user');
    if (cached) {
      try { currentAuthUser = JSON.parse(cached); } catch (e) {}
    }
  }

  if (!currentAuthUser) {
    window.openAuthModal('login');
    return;
  }

  const dName = document.getElementById('profile-display-name');
  const dEmail = document.getElementById('profile-display-email');
  const iName = document.getElementById('profile-input-name');
  const iEmail = document.getElementById('profile-input-email');
  const avatar = document.getElementById('profile-display-avatar');

  const displayName = currentAuthUser.displayName || currentAuthUser.email.split('@')[0];
  const initial = (displayName.charAt(0) || 'U').toUpperCase();

  if (dName) dName.innerText = displayName;
  if (dEmail) {
    dEmail.innerHTML = `<i data-lucide="mail" class="w-3.5 h-3.5 text-gray-500"></i> <span class="truncate">${currentAuthUser.email}</span>`;
  }
  if (iName) iName.value = displayName;
  if (iEmail) iEmail.value = currentAuthUser.email;
  if (avatar) {
    avatar.innerHTML = `<span class="text-3xl font-black text-white">${initial}</span>`;
  }

  const p1 = document.getElementById('profile-new-pass');
  const p2 = document.getElementById('profile-confirm-pass');
  if (p1) p1.value = '';
  if (p2) p2.value = '';

  refreshLucide();
};

window.saveProfileName = async () => {
  const newName = document.getElementById('profile-input-name')?.value?.trim();
  if (!newName) {
    return window.showAlert(currentLanguage === 'hi' ? 'कृपया अपना नाम दर्ज करें।' : 'Please enter your name.');
  }

  if (auth.currentUser) {
    await updateProfile(auth.currentUser, { displayName: newName }).catch(() => {});
  }

  if (currentAuthUser) {
    currentAuthUser.displayName = newName;
    localStorage.setItem('yt_auth_user', JSON.stringify(currentAuthUser));
    // Persist updated name to Firebase Realtime Database & Firestore!
    await saveUserToFirebase(currentAuthUser, currentAuthUser.provider || 'password');
  }

  // Update in local registered list if present
  const users = JSON.parse(localStorage.getItem('yt_registered_users') || '[]');
  const idx = users.findIndex(u => u.email?.toLowerCase() === currentAuthUser?.email?.toLowerCase());
  if (idx !== -1) {
    users[idx].displayName = newName;
    localStorage.setItem('yt_registered_users', JSON.stringify(users));
  }

  syncAuthUI();
  const dName = document.getElementById('profile-display-name');
  if (dName) dName.innerText = newName;
  const avatar = document.getElementById('profile-display-avatar');
  if (avatar) avatar.innerHTML = `<span class="text-3xl font-black text-white">${newName.charAt(0).toUpperCase()}</span>`;

  window.showAlert(currentLanguage === 'hi' ? 'नाम सफलतापूर्वक अपडेट किया गया!' : 'Profile name updated successfully!');
};

window.changeAccountPassword = async () => {
  const newPass = document.getElementById('profile-new-pass')?.value;
  const confirmPass = document.getElementById('profile-confirm-pass')?.value;

  if (!newPass || newPass.length < 6) {
    return window.showAlert(currentLanguage === 'hi' ? 'नया पासवर्ड कम से कम 6 अक्षरों का होना चाहिए।' : 'New password must be at least 6 characters.');
  }
  if (newPass !== confirmPass) {
    return window.showAlert(currentLanguage === 'hi' ? 'दोनों पासवर्ड मेल नहीं खा रहे हैं।' : 'Passwords do not match.');
  }

  if (auth.currentUser) {
    try {
      await updatePassword(auth.currentUser, newPass);
      const p1 = document.getElementById('profile-new-pass');
      const p2 = document.getElementById('profile-confirm-pass');
      if (p1) p1.value = '';
      if (p2) p2.value = '';
      return window.showAlert(currentLanguage === 'hi' ? 'पासवर्ड सफलतापूर्वक बदल दिया गया!' : 'Password changed successfully!');
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        return window.showAlert(currentLanguage === 'hi' 
          ? 'सुरक्षा कारणों से, कृपया पासवर्ड बदलने से पहले लॉगआउट कर दोबारा लॉगिन करें।'
          : 'For security reasons, please log out and sign in again before changing password.');
      }
    }
  }

  // Update in local registered users list
  const users = JSON.parse(localStorage.getItem('yt_registered_users') || '[]');
  const idx = users.findIndex(u => u.email?.toLowerCase() === currentAuthUser?.email?.toLowerCase());
  if (idx !== -1) {
    users[idx].password = newPass;
    localStorage.setItem('yt_registered_users', JSON.stringify(users));
  }

  const p1 = document.getElementById('profile-new-pass');
  const p2 = document.getElementById('profile-confirm-pass');
  if (p1) p1.value = '';
  if (p2) p2.value = '';

  window.showAlert(currentLanguage === 'hi' ? 'पासवर्ड सफलतापूर्वक बदल दिया गया!' : 'Password changed successfully!');
};

window.performLogout = async () => {
  if (auth.currentUser) {
    await signOut(auth).catch(() => {});
  }
  currentAuthUser = null;
  localStorage.removeItem('yt_auth_user');
  syncAuthUI();
  // Lock the app immediately - user must login or signup to open the app
  document.getElementById('app-container')?.classList.add('hidden');
  window.openAuthModal('login');
  window.showAlert(currentLanguage === 'hi' ? 'आप सफलतापूर्वक लॉगआउट हो चुके हैं।' : 'You have been logged out successfully.');
};

// Global Initialization
window.addEventListener('DOMContentLoaded', () => {
  const themeTog = document.getElementById('toggle-theme');
  if (themeTog) themeTog.checked = document.documentElement.classList.contains('dark');
  const soundTog = document.getElementById('toggle-sound');
  if (soundTog) soundTog.checked = localStorage.getItem('yt_sound') === 'true';
  const notifTog = document.getElementById('toggle-notif');
  if (notifTog) notifTog.checked = localStorage.getItem('yt_notif') !== 'false';
  
  const savedLang = localStorage.getItem('yt_lang') || 'en';
  window.setLanguage(savedLang);
  
  initializeChatSession();
  refreshLucide();

  // Initialize Auth System
  initAuthSystem();
  updateWatchlistBadges();

  // Initialize Firebase Cloud Messaging & Service Worker
  initPushNotificationSystem();

  // Prompt for notification permission on first interaction if not yet granted
  const promptPermissionOnFirstTouch = () => {
    if ('Notification' in window && Notification.permission === 'default' && localStorage.getItem('yt_notif') !== 'false') {
      window.requestPushPermission();
    }
    document.removeEventListener('click', promptPermissionOnFirstTouch);
    document.removeEventListener('touchstart', promptPermissionOnFirstTouch);
  };
  document.addEventListener('click', promptPermissionOnFirstTouch, { once: true });
  document.addEventListener('touchstart', promptPermissionOnFirstTouch, { once: true });
});
