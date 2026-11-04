import { X } from 'lucide-react';

type ProfilePanelProps = {
  profile: {
    username: string | null;
    total_pins_created?: number;
    total_votes_received?: number;
  };
  badge: {
    name: string;
    color: string;
    icon: React.ReactNode;
  };
  onClose: () => void;
};

export default function ProfilePanel({ profile, badge, onClose }: ProfilePanelProps) {
  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="invite-modal" style={{ maxWidth: '400px', width: '90%' }}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">KULLANICI PROFİLİ</p>
            <h2>{profile.username || 'Gözcü'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Kapat"><X size={18}/></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0', gap: '15px' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--primary)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: '32px', fontWeight: 'bold' }}>
            {(profile.username || 'U').charAt(0).toUpperCase()}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: '999px', color: badge.color, fontWeight: 'bold', fontSize: '14px' }}>
            {badge.icon} {badge.name}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '12px', textAlign: 'center', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#3b82f6' }}>{profile.total_pins_created || 0}</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '5px' }}>Toplam Pin</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '12px', textAlign: 'center', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#22c55e' }}>{profile.total_votes_received || 0}</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '5px' }}>Toplam Oy</div>
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '15px' }}>
          <p style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', margin: 0 }}>
            Daha fazla pin ekleyerek yeni rozetler kazanabilirsin!
          </p>
        </div>
      </div>
    </div>
  );
}
