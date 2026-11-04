import { Camera, LoaderCircle, LocateFixed, Mic, X } from 'lucide-react';

type SpeechSetter = (value: string | ((current: string) => string)) => void;

type Props = {
  draftPosition: [number, number];
  description: string;
  setDescription: SpeechSetter;
  category: string;
  setCategory: (value: string) => void;
  files: File[];
  setFiles: (updater: any) => void;
  busy: boolean;
  locating: boolean;
  locateUser: (useForDraft?: boolean) => void;
  speechSupported: boolean;
  listeningField: string | null;
  hasProfanity: boolean;
  startListening: (field: string, setter: SpeechSetter) => void;
  isRecording: boolean;
  voiceNoteBlob: Blob | null;
  voiceNotePreviewUrl: string | null;
  startRecording: () => void;
  stopRecording: () => void;
  clearVoiceNote: () => void;
  setNotice: (notice: any) => void;
  onSubmit: (event: any) => void;
  onClose: () => void;
};

export default function PinCreateForm({
  draftPosition, description, setDescription, category, setCategory, files, setFiles,
  busy, locating, locateUser, speechSupported, listeningField, hasProfanity,
  startListening, isRecording, voiceNoteBlob, voiceNotePreviewUrl,
  startRecording, stopRecording, clearVoiceNote, setNotice, onSubmit, onClose,
}: Props) {
  return (
    <form className="panel-content" onSubmit={onSubmit}>
      <div className="panel-heading"><div><p className="eyebrow">YENİ PAYLAŞIM</p><h2>Konum ekle</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Konum ekleme formunu kapat"><X size={18}/></button></div>
      <div className="draft-coordinates-row"><p className="coordinates">{draftPosition[0].toFixed(5)}, {draftPosition[1].toFixed(5)}</p><button type="button" className="use-location-button" onClick={() => locateUser(true)} disabled={locating} title="GPS konumunu kullan">{locating?<LoaderCircle className="gps-spinner" size={15}/>:<LocateFixed size={15}/>}<span>{locating?'Konum alınıyor…':'Konumumu Kullan'}</span></button></div>
      <p className="draft-location-hint">📍 Konumu değiştirmek için haritada başka bir noktaya tıklayabilir veya yandaki GPS butonunu kullanabilirsiniz.</p>
      <label className="field-label" htmlFor="category">Kategori</label>
      <select id="category" className="category-select" value={category} onChange={e => setCategory(e.target.value)}><option value="YEŞİL">YEŞİL</option><option value="MAVİ">MAVİ</option><option value="KIRMIZI">KIRMIZI</option><option value="SARI">SARI</option></select>
      <label className="field-label" htmlFor="description">Açıklama</label>
      <div className={`voice-textarea-wrap ${speechSupported?'voice-supported':''}`}><textarea id="description" className={speechSupported?'voice-enabled-input':''} value={description} onChange={e => setDescription(e.target.value)} maxLength={5000} placeholder={listeningField==='description'?'Dinleniyor...':'Bu konum hakkında ne paylaşmak istersin?'} rows={3}/>{hasProfanity&&<p role="alert" style={{color:"#dc2626",fontSize:"13px",margin:"6px 0 0"}}>⚠️ Açıklamanızda uygun olmayan bir ifade tespit edildi.</p>}{speechSupported&&<button type="button" className={`voice-button textarea-voice-button ${listeningField==='description'?'is-listening':''}`} onClick={() => startListening('description', setDescription)} aria-label={listeningField==='description'?'Dinlemeyi durdur':'Açıklamaya sesli giriş'} title={listeningField==='description'?'Dinleniyor...':'Sesli giriş'}><Mic size={16}/></button>}</div>
      <label className="field-label" style={{marginTop: '12px'}}>Sesli Not <span>İsteğe bağlı</span></label>
      <div className="voice-note-recorder">
        {!isRecording && !voiceNoteBlob && <button type="button" className="record-btn" onClick={startRecording}><Mic size={18}/> Bas ve Konuş</button>}
        {isRecording && <button type="button" className="record-btn is-recording" onClick={stopRecording}><div className="recording-pulse"/> Kaydı Bitir</button>}
        {voiceNotePreviewUrl && !isRecording && <div className="voice-note-preview"><audio controls src={voiceNotePreviewUrl} className="voice-note-audio-preview"/><button type="button" className="clear-voice-btn" onClick={clearVoiceNote} aria-label="Sesi sil"><X size={16}/></button></div>}
      </div>
      <label className="field-label" htmlFor="photo-input">Fotoğraflar <span>İsteğe bağlı · En fazla 3 adet</span></label>
      <label className="upload-box" htmlFor="photo-input"><Camera size={22}/><strong>Fotoğraf seç</strong><small>Görsel dosyası · dosya başına en fazla 12 MB</small><input id="photo-input" type="file" accept="image/*" capture="environment" multiple onChange={e => {const selectedFiles=Array.from(e.target.files??[]);setFiles(selectedFiles);setNotice(selectedFiles.length>3?{kind:'error',text:'En fazla 3 fotoğraf seçebilirsin.'}:null);}}/></label>
      {files.length>0&&<div className="file-list">{files.map((file,i)=><div key={`${file.name}-${i}`}><span>{file.name}</span><button type="button" onClick={() => setFiles((old: File[]) => old.filter((_,j)=>j!==i))} aria-label="Dosyayı kaldır"><X size={14}/></button></div>)}</div>}
      <button className="primary-button full-width" disabled={busy||files.length>3||hasProfanity}>{busy?'Kaydediliyor…':'Konumu kaydet'}</button>
      <p className="info-text" style={{fontSize:"12px",color:"#94a3b8",marginTop:"10px",textAlign:"center"}}>Bilgilendirme: Paylaşımlarınız haritada 24 saat boyunca görünür kalır.</p>
    </form>
  );
}
