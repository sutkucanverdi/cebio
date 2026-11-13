// Uygulama içinde (iframe) açıldığında üst gezinme bağlantılarını gizle
if (window.self !== window.top) document.documentElement.classList.add('embedded');
