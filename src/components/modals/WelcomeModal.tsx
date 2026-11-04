import { useState } from 'react';

function WelcomeModal({ onClose }: { onClose: (dontShowAgain: boolean) => void }) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const items = [
    { icon: '📍', color: '#22d3ee', title: 'Haritada paylaş', text: 'Pin bırak, açıklama, emoji ve fotoğraf ekle. Pinler 24 saat sonra kaybolur.' },
    { icon: '💬', color: '#a78bfa', title: 'Etkileşime geç', text: 'Pinlere yorum yap, +puan ver, fotoğraf ve emoji bırak.' },
    { icon: '👥', color: '#34d399', title: 'Üyelerle bağlantı kur', text: 'Mesajlaş, sesli veya görüntülü ara. İstersen engelle ya da sessize al.' },
    { icon: '🗺️', color: '#fbbf24', title: 'Rotanı oluştur', text: 'Rota çiz ve güzergâhındaki pinleri keşfet.' },
    { icon: '🔔', color: '#fb7185', title: 'Gelişmeleri kaçırma', text: 'Bildirimlere izin ver, anlık gelişmelerden haberdar ol.' },
  ];
  return (
    <div className="aytar-welcome-backdrop" role="presentation">
      <section className="aytar-welcome-card" role="dialog" aria-modal="true" aria-labelledby="aytar-welcome-title">
        <div className="aytar-welcome-kicker">DAİMA İLERİ</div>
        <h2 id="aytar-welcome-title">AYTAR'a Hoş Geldin!<br/><span>Daima İleri 🚀</span></h2>
        <p className="aytar-welcome-intro">Şehrin nabzını birlikte tutalım.</p>
        <div className="aytar-welcome-list">
          {items.map(item => (
            <div className="aytar-welcome-item" key={item.title}>
              <div className="aytar-welcome-icon" style={{ color: item.color, borderColor: `${item.color}55`, background: `${item.color}16`, boxShadow: `0 0 22px ${item.color}20` }}>{item.icon}</div>
              <div className="aytar-welcome-copy"><strong style={{ color: item.color }}>{item.title}</strong><p>{item.text}</p></div>
            </div>
          ))}
        </div>
        <label className="aytar-welcome-check"><input type="checkbox" checked={dontShowAgain} onChange={event => setDontShowAgain(event.target.checked)}/><span>Bir daha gösterme</span></label>
        <button type="button" className="aytar-welcome-button" onClick={() => onClose(dontShowAgain)}>Anladım, Başlayalım!</button>
      </section>
      <style>{`
        .aytar-welcome-backdrop{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(2,6,18,.78);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
        .aytar-welcome-card{width:min(100%,540px);max-height:min(88vh,820px);overflow-y:auto;overscroll-behavior:contain;padding:clamp(20px,4vw,34px);border:1px solid rgba(34,211,238,.38);border-radius:22px;background:radial-gradient(ellipse at 50% 0%,rgba(14,116,144,.2),transparent 48%),linear-gradient(155deg,#101b30 0%,#080f1d 72%);box-shadow:0 0 0 1px rgba(139,92,246,.12),0 24px 90px rgba(0,0,0,.65),0 0 38px rgba(6,182,212,.12);color:#e2e8f0}
        .aytar-welcome-kicker{font-size:10px;letter-spacing:.28em;font-weight:800;color:#22d3ee;text-align:center;margin-bottom:10px}
        .aytar-welcome-card h2{margin:0;text-align:center;font-size:clamp(23px,5vw,31px);line-height:1.25;font-weight:850;color:#f8fafc;text-shadow:0 0 22px rgba(34,211,238,.2)}
        .aytar-welcome-card h2 span{color:#67e8f9}
        .aytar-welcome-intro{text-align:center;color:#94a3b8;font-size:13px;margin:10px 0 22px}
        .aytar-welcome-list{display:flex;flex-direction:column;gap:10px}
        .aytar-welcome-item{display:flex;align-items:center;gap:15px;padding:12px 14px;border:1px solid rgba(148,163,184,.13);border-radius:14px;background:rgba(15,23,42,.68)}
        .aytar-welcome-icon{flex:0 0 56px;width:56px;height:56px;display:grid;place-items:center;border:1px solid;border-radius:15px;font-size:31px;line-height:1}
        .aytar-welcome-copy{min-width:0}.aytar-welcome-copy strong{display:block;font-size:14px;font-weight:800;margin-bottom:4px}.aytar-welcome-copy p{margin:0;color:#cbd5e1;font-size:12.5px;line-height:1.5}
        .aytar-welcome-check{display:flex;align-items:center;gap:9px;margin:18px 2px 14px;color:#cbd5e1;font-size:13px;cursor:pointer}.aytar-welcome-check input{width:17px;height:17px;accent-color:#06b6d4;cursor:pointer}
        .aytar-welcome-button{width:100%;min-height:48px;border:1px solid rgba(103,232,249,.75);border-radius:12px;background:linear-gradient(100deg,#0891b2,#2563eb);color:white;font-size:14px;font-weight:800;letter-spacing:.01em;cursor:pointer;box-shadow:0 0 24px rgba(6,182,212,.2);transition:filter .2s,transform .2s}.aytar-welcome-button:hover{filter:brightness(1.13);transform:translateY(-1px)}
        @media(max-width:480px){.aytar-welcome-backdrop{padding:10px}.aytar-welcome-card{max-height:92dvh;padding:19px 15px;border-radius:18px}.aytar-welcome-item{gap:11px;padding:10px}.aytar-welcome-icon{flex-basis:48px;width:48px;height:48px;font-size:27px;border-radius:12px}.aytar-welcome-copy p{font-size:12px}}
        @media(prefers-reduced-motion:reduce){.aytar-welcome-button{transition:none}}
      `}</style>
    </div>
  );
}
