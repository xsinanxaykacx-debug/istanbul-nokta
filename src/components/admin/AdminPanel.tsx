import type { Dispatch, SetStateAction } from 'react';
import { X } from 'lucide-react';

type AdminProfile = {
  id: string;
  username?: string | null;
  status: string;
  role?: string | null;
};

type AdminReport = {
  id: string;
  pin_id?: string | null;
  pin_description?: string | null;
  created_at: string;
  pins?: { description?: string | null; category?: string | null } | null;
};

type AdminPin = {
  id: string;
  owner_id: string;
  description: string;
  category: string | null;
  created_at: string;
};

interface AdminPanelProps {
  onClose: () => void;
  adminTab: 'users' | 'reports' | 'pins';
  onAdminTabChange: (tab: 'users' | 'reports' | 'pins') => void;
  adminLoading: boolean;
  adminProfiles: AdminProfile[];
  adminReports: AdminReport[];
  pins: AdminPin[];
  bulkSelectedPins: string[];
  setBulkSelectedPins: Dispatch<SetStateAction<string[]>>;
  busy: boolean;
  onUpdateUserStatus: (userId: string, newStatus: string) => void | Promise<void>;
  onDeleteBulkPins: () => void | Promise<void>;
  onResolveReport: (reportId: string, action: 'ignore' | 'delete') => void | Promise<void>;
  pinDescription: (pin: any) => string;
}

export default function AdminPanel({
  onClose,
  adminTab,
  onAdminTabChange,
  adminLoading,
  adminProfiles,
  adminReports,
  pins,
  bulkSelectedPins,
  setBulkSelectedPins,
  busy,
  onUpdateUserStatus,
  onDeleteBulkPins,
  onResolveReport,
  pinDescription
}: AdminPanelProps) {
  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="invite-modal" style={{ maxWidth: '800px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-head">
          <div><p className="eyebrow">YÖNETİCİ PANELİ</p><h2>Yönetim Merkezi</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px' }}>
          <button onClick={() => onAdminTabChange('users')} style={{ background: 'none', border: 'none', color: adminTab === 'users' ? '#fff' : '#94a3b8', borderBottom: adminTab === 'users' ? '2px solid #3b82f6' : 'none', padding: '5px 10px', cursor: 'pointer', fontWeight: 'bold' }}>Kullanıcılar</button>
          <button onClick={() => onAdminTabChange('reports')} style={{ background: 'none', border: 'none', color: adminTab === 'reports' ? '#fff' : '#94a3b8', borderBottom: adminTab === 'reports' ? '2px solid #ef4444' : 'none', padding: '5px 10px', cursor: 'pointer', fontWeight: 'bold' }}>Raporlar ({adminReports.length})</button>
          <button onClick={() => onAdminTabChange('pins')} style={{ background: 'none', border: 'none', color: adminTab === 'pins' ? '#fff' : '#94a3b8', borderBottom: adminTab === 'pins' ? '2px solid #ef4444' : 'none', padding: '5px 10px', cursor: 'pointer', fontWeight: 'bold' }}>Pin Yönetimi ({pins.length})</button>
        </div>
        {adminLoading ? <p style={{ textAlign: 'center', padding: '20px' }}>Yükleniyor...</p> : adminTab === 'users' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '20px' }}>
            {adminProfiles.map(profile => (
              <div key={profile.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '10px 15px', borderRadius: '8px' }}>
                <div>
                  <strong style={{ display: 'block', fontSize: '14px' }}>{profile.username || `Kullanıcı: ${profile.id.slice(0, 8)}...`}</strong>
                  <span style={{ fontSize: '12px', color: profile.status === 'active' ? '#4ade80' : profile.status === 'disabled' ? '#f87171' : '#fbbf24' }}>Durum: {profile.status === 'active' ? 'Aktif' : profile.status === 'disabled' ? 'Banlı' : 'Onay Bekliyor'}</span>
                  {profile.role === 'admin' && <span style={{ marginLeft: '10px', fontSize: '10px', background: '#3b82f6', padding: '2px 6px', borderRadius: '4px' }}>ADMIN</span>}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {profile.status !== 'active' && <button onClick={() => void onUpdateUserStatus(profile.id, 'active')} className="primary-button" style={{ padding: '6px 12px', fontSize: '12px' }}>Onayla</button>}
                  {profile.status === 'active' && profile.role !== 'admin' && <button onClick={() => void onUpdateUserStatus(profile.id, 'disabled')} className="delete-pin-button" style={{ padding: '6px 12px', fontSize: '12px', marginTop: 0 }}>Banla</button>}
                </div>
              </div>
            ))}
          </div>
        ) : adminTab === 'pins' ? (
          <div className="admin-pin-management">
            <div className="admin-pin-toolbar">
              <label className="admin-pin-select-all">
                <input type="checkbox" checked={pins.length > 0 && bulkSelectedPins.length === pins.length} disabled={pins.length === 0 || busy} onChange={event => setBulkSelectedPins(event.target.checked ? pins.map(pin => pin.id) : [])} />
                <strong>Tümünü Seç ({pins.length})</strong>
              </label>
              <button type="button" className="delete-pin-button" disabled={bulkSelectedPins.length === 0 || busy} onClick={() => void onDeleteBulkPins()} style={{ marginTop: 0, padding: '8px 12px' }}>{busy ? 'Siliniyor…' : `Seçilenleri Sil (${bulkSelectedPins.length})`}</button>
            </div>
            {pins.length === 0 ? <p style={{ textAlign: 'center', color: '#94a3b8', padding: '16px' }}>Listelenecek pin bulunamadı.</p> : pins.map(pin => (
              <label key={pin.id} className={`admin-pin-row${bulkSelectedPins.includes(pin.id) ? ' is-selected' : ''}`}>
                <input className="admin-pin-checkbox" type="checkbox" checked={bulkSelectedPins.includes(pin.id)} disabled={busy} onChange={event => setBulkSelectedPins(current => event.target.checked ? (current.includes(pin.id) ? current : [...current, pin.id]) : current.filter(id => id !== pin.id))} />
                <span className="admin-pin-info">
                  <strong className="admin-pin-title">{(pinDescription(pin).trim() || 'Açıklamasız konum').slice(0, 30)}</strong>
                  <span className="admin-pin-meta">Kategori: {pin.category || 'Belirtilmemiş'} · {new Date(pin.created_at).toLocaleString('tr-TR')} | Ekleyen: {adminProfiles.find(profile => profile.id === pin.owner_id)?.username || 'Bilinmiyor'}</span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '20px' }}>
            {adminReports.length === 0 && <p style={{ textAlign: 'center' }}>Harika, rapor edilen pin yok!</p>}
            {adminReports.map(report => (
              <div key={report.id} style={{ display: 'flex', flexDirection: 'column', background: 'rgba(239, 68, 68, 0.1)', padding: '10px 15px', borderRadius: '8px', borderLeft: '4px solid #ef4444' }}>
                <strong style={{ display: 'block', fontSize: '14px' }}>Şikayet Edilen Pin: {report.pin_description ? `${report.pin_description.slice(0, 30)}...` : (report.pins?.description ? `${report.pins.description.slice(0, 30)}...` : 'Açıklama Yok')}</strong>
                <span style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>Tarih: {new Date(report.created_at).toLocaleDateString('tr-TR')}</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {report.pin_id && <button onClick={() => void onResolveReport(report.id, 'delete')} className="delete-pin-button" style={{ padding: '6px 12px', fontSize: '12px', marginTop: 0 }}>Pini Sil ve Kapat</button>}
                  <button onClick={() => void onResolveReport(report.id, 'ignore')} className="secondary-button" style={{ padding: '6px 12px', fontSize: '12px', marginTop: 0 }}>Yoksay</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
