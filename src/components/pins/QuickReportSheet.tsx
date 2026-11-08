import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Radar,
  Shield,
  TrafficCone,
  Ambulance,
  OctagonMinus,
  TriangleAlert,
  MapPin,
  X,
  Check,
  Loader2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

// =============================================================
// Hızlı İhbar (Quick Report) — LAB
// Mevcut detaylı pin akışına DOKUNMAZ.
// RPC: create_quick_report (yalnızca bunu çağırır)
// Ölçüm: quick_report_stats
//   created / cancelled -> istemciden (bu bileşen)
//   confirmed           -> RPC (SECURITY DEFINER)
// =============================================================

type QuickCategory =
  | 'kaza'
  | 'radar'
  | 'polis'
  | 'yol_calismasi'
  | 'tehlike'
  | 'yol_kapali';

type Step = 'category' | 'confirm';

interface QuickReportSheetProps {
  open: boolean;
  onClose: () => void;
  onReported?: () => void;
  onError?: (message: string) => void;
}

interface CategoryDef {
  key: QuickCategory;
  label: string;
  Icon: typeof Radar;
  color: string;
}

const CATEGORIES: CategoryDef[] = [
  { key: 'polis',         label: 'Sivil Trafik Polisi',    Icon: Shield,        color: '#3b82f6' },
  { key: 'yol_calismasi', label: 'Trafik Kontrol Noktası', Icon: TrafficCone,   color: '#f59e0b' },
  { key: 'radar',         label: 'Mobil Radar',            Icon: Radar,         color: '#eab308' },
  { key: 'kaza',          label: 'Yolda Kaza',             Icon: Ambulance,     color: '#ef4444' },
  { key: 'yol_kapali',    label: 'Yol Kapalı',             Icon: OctagonMinus,  color: '#64748b' },
  { key: 'tehlike',       label: 'Yolda Tehlike',          Icon: TriangleAlert, color: '#f97316' },
];

const QUICK_CATEGORY_LABEL: Record<QuickCategory, string> = {
  kaza: 'Yolda Kaza',
  radar: 'Mobil Radar',
  polis: 'Sivil Trafik Polisi',
  yol_calismasi: 'Trafik Kontrol Noktası',
  tehlike: 'Yolda Tehlike',
  yol_kapali: 'Yol Kapalı',
};

interface SessionRef {
  id: string;
  createdLogged: boolean;
  cancelledLogged: boolean;
  cancelledPending: boolean; // senkron kilit: INSERT sürerken ikinci iptali engeller
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function QuickReportSheet({
  open,
  onClose,
  onReported,
  onError,
}: QuickReportSheetProps) {
  const [step, setStep] = useState<Step>('category');
  const [selectedCategory, setSelectedCategory] = useState<QuickCategory | null>(null);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<SessionRef | null>(null);
  const mountedRef = useRef(true);

  // -------------------------------------------------------------
  // Yardımcı: quick_report_stats'a olay yaz (created / cancelled)
  // confirmed RPC tarafından yazılır, burada YAZILMAZ.
  // getSession() kullanılır: JWT'yi RLS doğrular, ekstra ağ isteği yok.
  // -------------------------------------------------------------
  const logClientEvent = async (
    eventType: 'created' | 'cancelled',
    category: QuickCategory
  ) => {
    // LAB UI TEST GUARD - test sonrasi kaldir
    if (import.meta.env.VITE_LAB_UI_TEST === '1') return;

    if (!supabase) return;
    const session = sessionRef.current;
    if (!session) return;

    if (eventType === 'created') {
      if (session.createdLogged) return;
      session.createdLogged = true;
    }

    if (eventType === 'cancelled') {
      if (session.cancelledLogged) return;
      if (session.cancelledPending) return;
      session.cancelledPending = true;
    }

    try {
      const {
        data: { session: authSession },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !authSession?.user?.id) {
        if (eventType === 'cancelled') session.cancelledPending = false;
        if (eventType === 'created') session.createdLogged = false;
        return;
      }

      const { error: insertError } = await supabase
        .from('quick_report_stats')
        .insert({
          report_session_id: session.id,
          user_id: authSession.user.id,
          event_type: eventType,
          quick_category: category,
        });

      if (insertError) {
        console.warn('[quick-report] stats insert failed:', insertError.message);
        if (eventType === 'cancelled') session.cancelledPending = false;
        if (eventType === 'created') session.createdLogged = false;
        return;
      }

      if (eventType === 'cancelled') {
        session.cancelledPending = false;
        session.cancelledLogged = true;
      }
    } catch (err) {
      console.warn('[quick-report] stats insert exception:', err);
      if (eventType === 'cancelled') session.cancelledPending = false;
      if (eventType === 'created') session.createdLogged = false;
    }
  };

  const handleClose = (reason: 'user' | 'reported') => {
    const session = sessionRef.current;
    const cat = selectedCategory;

    if (reason === 'user' && session && cat) {
      void logClientEvent('cancelled', cat);
    }

    setStep('category');
    setSelectedCategory(null);
    setPosition(null);
    setLoading(false);
    setError(null);
    onClose();
  };

  const handleCategoryClick = (category: QuickCategory) => {
    if (loading) return;
    if (!supabase) {
      setError('Bağlantı yapılandırılmamış.');
      return;
    }

    setError(null);
    setLoading(true);
    setSelectedCategory(category);

    if (!navigator.geolocation) {
      setLoading(false);
      setSelectedCategory(null);
      setError('Konum servisi bu cihazda desteklenmiyor.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (!mountedRef.current) return;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        if (!sessionRef.current) {
          sessionRef.current = {
            id: newSessionId(),
            createdLogged: false,
            cancelledLogged: false,
            cancelledPending: false,
          };
        }

        setPosition({ lat, lng });
        await logClientEvent('created', category);

        if (!mountedRef.current) return;
        setLoading(false);
        setStep('confirm');
      },
      (err) => {
        if (!mountedRef.current) return;
        setLoading(false);
        setSelectedCategory(null);
        const msg =
          err.code === err.PERMISSION_DENIED
            ? 'Konum izni verilmedi.'
            : err.code === err.POSITION_UNAVAILABLE
            ? 'Konum bilgisi alınamadı.'
            : 'Konum alınırken zaman aşımı.';
        setError(msg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleConfirm = async () => {
    // LAB UI TEST GUARD - test sonrasi kaldir
    if (import.meta.env.VITE_LAB_UI_TEST === '1') {
      setError('LAB UI test modu: RPC devre disi.');
      return;
    }

    if (loading) return;
    if (!supabase) {
      setError('Bağlantı yapılandırılmamış.');
      return;
    }
    const session = sessionRef.current;
    if (!session || !selectedCategory || !position) {
      setError('Eksik bilgi. Lütfen tekrar dene.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: rpcError } = await supabase.rpc('create_quick_report', {
        p_lat: position.lat,
        p_lng: position.lng,
        p_quick_category: selectedCategory,
        p_report_session_id: session.id,
        p_description: null,
      });

      if (rpcError) {
        setLoading(false);
        setError(`İhbar gönderilemedi: ${rpcError.message}`);
        if (onError) onError(rpcError.message);
        return;
      }

      if (!mountedRef.current) return;
      setLoading(false);
      if (onReported) onReported();
      sessionRef.current = null;
      handleClose('reported');
    } catch (err) {
      if (!mountedRef.current) return;
      setLoading(false);
      const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
      setError(`İhbar gönderilemedi: ${msg}`);
      if (onError) onError(msg);
    }
  };

  const handleCancel = () => {
    if (loading) return;
    handleClose('user');
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  };

  useEffect(() => {
    if (!open) {
      const session = sessionRef.current;
      const cat = selectedCategory;
      if (session && cat) {
        void logClientEvent('cancelled', cat);
      }
      sessionRef.current = null;
      setStep('category');
      setSelectedCategory(null);
      setPosition(null);
      setLoading(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (!open) return null;

  return (
    <div
      className="quick-report-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Hızlı ihbar"
      onClick={handleBackdropClick}
    >
      <div className="quick-report-sheet">
        <div className="quick-report-header">
          <h2>
            {step === 'category' ? 'Ne görüyorsun?' : 'İhbarı onayla'}
          </h2>
          <button
            type="button"
            className="quick-report-close"
            aria-label="Kapat"
            onClick={handleCancel}
            disabled={loading}
          >
            <X size={20} />
          </button>
        </div>

        {step === 'category' && (
          <>
            <p className="quick-report-hint">
              Kategoriye dokun; konumun otomatik alınacak.
            </p>
            <div className="quick-report-grid">
              {CATEGORIES.map(({ key, label, Icon, color }) => (
                <button
                  key={key}
                  type="button"
                  className="quick-category-card"
                  onClick={() => handleCategoryClick(key)}
                  disabled={loading}
                  style={{ '--cat-color': color } as CSSProperties}
                >
                  <div className="quick-category-icon-wrapper">
                    <Icon size={24} color={color} />
                  </div>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'confirm' && selectedCategory && position && (
          <div className="quick-report-confirm">
            <div className="quick-report-preview">
              {(() => {
                const def = CATEGORIES.find((c) => c.key === selectedCategory);
                const Icon = def ? def.Icon : MapPin;
                return <Icon size={26} />;
              })()}
              <div>
                <strong>{QUICK_CATEGORY_LABEL[selectedCategory]}</strong>
                <div className="quick-report-location">
                  <MapPin size={14} />
                  <span>
                    {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
                  </span>
                </div>
              </div>
            </div>
            <p className="quick-report-hint">
              İhbar bu konumla haritaya düşecek. Onaylıyor musun?
            </p>
            <div className="quick-report-actions">
              <button
                type="button"
                className="quick-report-btn quick-report-btn-cancel"
                onClick={handleCancel}
                disabled={loading}
              >
                İptal
              </button>
              <button
                type="button"
                className="quick-report-btn quick-report-btn-confirm"
                onClick={handleConfirm}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="quick-report-spinner" />
                    Gönderiliyor...
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    Onayla
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {error && <div className="quick-report-error">{error}</div>}
      </div>
    </div>
  );
}
