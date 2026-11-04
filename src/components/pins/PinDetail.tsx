import { Camera, LoaderCircle, MapPin, Mic, Navigation, Radar, ShieldAlert, Volume2, X } from 'lucide-react';

type Props = {
  selected: any;
  editPinMode: boolean;
  editDescription: string;
  setEditDescription: (value: string) => void;
  editCategory: string;
  setEditCategory: (value: string) => void;
  editPhotos: any[];
  setEditPhotos: (updater: any) => void;
  editFiles: File[];
  setEditFiles: (updater: any) => void;
  editError: string | null;
  setEditError: (value: string | null) => void;
  photoUrls: Record<string, string>;
  busy: boolean;
  containsProfanity: (value: string) => boolean;
  onSaveEdits: (event: any) => void;
  onExitEdit: () => void;
  pinTitle: (pin: any) => string;
  categoryClass: (category?: string | null) => string;
  normalizeCategory: (category?: string | null) => string;
  isTelegramPin: (description?: string | null, ownerId?: string | null) => boolean;
  relativeTime: (iso: string) => string;
  pinDescription: (pin: any) => string;
  selectedPhotos: any[];
  setLightboxIndex: (index: number | null) => void;
  selectedAddress: string | null;
  reactions: any[];
  session: any;
  onToggleReaction: (emoji: string) => void;
  onToggleVote: (vote: 1 | -1) => void;
  comments: any[];
  newComment: string;
  setNewComment: (value: string) => void;
  onSubmitComment: (event: any) => void;
  busyComment: boolean;
  onClose: () => void;
  onBuildRoute: (pin: any) => void;
  canDeleteSelected: boolean;
  onBeginEdit: () => void;
  onDelete: (id: string) => void;
  onReport: (pin: any) => void;
};

export default function PinDetail(p: Props) {
  const {selected,editPinMode,editDescription,setEditDescription,editCategory,setEditCategory,editPhotos,setEditPhotos,editFiles,setEditFiles,editError,setEditError,photoUrls,busy,containsProfanity,onSaveEdits,onExitEdit,pinTitle,categoryClass,normalizeCategory,isTelegramPin,relativeTime,pinDescription,selectedPhotos,setLightboxIndex,selectedAddress,reactions,session,onToggleReaction,onToggleVote,comments,newComment,setNewComment,onSubmitComment,busyComment,onClose,onBuildRoute,canDeleteSelected,onBeginEdit,onDelete,onReport}=p;
  if (editPinMode) return (
    <form className="pin-edit-form" onSubmit={onSaveEdits}>
      <div className="panel-heading"><div><p className="eyebrow">KONUMU DÜZENLE</p><h2>{pinTitle(selected)}</h2><small className="edit-form-subtitle">Değişikliklerin yalnızca bu konuma uygulanır.</small></div><button type="button" className="icon-button" disabled={busy} onClick={onExitEdit} aria-label="Düzenlemeyi kapat"><X size={18}/></button></div>
      <div className="edit-field-group"><label className="field-label" htmlFor="edit-category">Kategori</label><select id="edit-category" className="category-select" value={editCategory} onChange={e=>{setEditCategory(e.target.value);setEditError(null);}}><option value="YEŞİL">YEŞİL</option><option value="MAVİ">MAVİ</option><option value="KIRMIZI">KIRMIZI</option><option value="SARI">SARI</option></select></div>
      <div className="edit-field-group"><label className="field-label" htmlFor="edit-description">Açıklama</label><textarea id="edit-description" value={editDescription} onChange={e=>{setEditDescription(e.target.value);setEditError(null);}} maxLength={5000} rows={4} placeholder="Konum açıklaması"/><div className="edit-description-meta"><small>En fazla 5.000 karakter</small><small>{editDescription.length.toLocaleString('tr-TR')}/5.000</small></div>{containsProfanity(editDescription)&&<p className="form-error" role="alert">Açıklamanızda uygun olmayan bir ifade tespit edildi.</p>}</div>
      <div className="edit-photos-heading"><span className="field-label">Mevcut fotoğraflar</span><small>{editPhotos.length+editFiles.length}/3</small></div>
      {editPhotos.length>0?<div className="edit-photo-list">{editPhotos.map(photo=><div className="edit-photo-item" key={photo.id}><img src={photoUrls[photo.storage_path]||photo.public_url} alt="Mevcut pin fotoğrafı"/><span>{photo.storage_path.split('/').pop()}</span><button type="button" className="edit-photo-remove" onClick={()=>{setEditPhotos((current:any[])=>current.filter(item=>item.id!==photo.id));setEditError(null);}} aria-label="Fotoğrafı sil" title="Fotoğrafı sil"><X size={15}/></button></div>)}</div>:<p className="comments-empty">Mevcut fotoğraf yok.</p>}
      <div className="edit-field-group"><label className="field-label" htmlFor="edit-photo-input">Yeni fotoğraf ekle <span>Kalan hak: {Math.max(0,3-editPhotos.length-editFiles.length)}</span></label><label className="upload-box edit-upload-box" htmlFor="edit-photo-input"><Camera size={22}/><strong>Fotoğraf seç</strong><small>Toplam en fazla 3 fotoğraf</small><input id="edit-photo-input" type="file" accept="image/*" multiple disabled={editPhotos.length+editFiles.length>=3||busy} onChange={e=>{const chosen=Array.from(e.target.files??[]);const totalAllowed=Math.max(0,3-editPhotos.length);const allowed=Math.max(0,totalAllowed-editFiles.length);setEditFiles((current:File[])=>[...current,...chosen.slice(0,Math.max(0,totalAllowed-current.length))].slice(0,totalAllowed));setEditError(chosen.length>allowed?'Toplam fotoğraf sayısı 3 adedi geçemez.':null);e.currentTarget.value='';}}/></label></div>
      {editFiles.length>0&&<div className="file-list">{editFiles.map((file,index)=><div key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" aria-label="Yeni fotoğrafı kaldır" onClick={()=>{setEditFiles((current:File[])=>current.filter((_,i)=>i!==index));setEditError(null);}}><X size={14}/></button></div>)}</div>}
      {editError&&<p className="form-error edit-form-error" role="alert">{editError}</p>}<div className="edit-form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onExitEdit}>İptal</button><button type="submit" className="primary-button" disabled={busy||editPhotos.length+editFiles.length>3||containsProfanity(editDescription)}>{busy?<><LoaderCircle size={15} className="gps-spinner"/> Kaydediliyor…</>:'Değişiklikleri Kaydet'}</button></div>
    </form>
  );
  return (
    <>
      <div className="panel-heading"><div><p className="eyebrow">KONUM DETAYI</p><span className={`category-badge ${categoryClass(selected.category)}`}>{normalizeCategory(selected.category)}</span>{isTelegramPin(selected.description,selected.owner_id)&&<span className="radar-source-badge"><Radar size={13}/> AYTAR RADAR</span>}<h2>{pinTitle(selected)}</h2></div><button className="icon-button" onClick={onClose} aria-label="Konum detayını kapat"><X size={18}/></button></div>
      <p className="pin-date">{relativeTime(selected.created_at)}</p><p className="pin-description">{pinDescription(selected)||'Açıklama eklenmemiş.'}</p>
      {selected.voice_note_url&&<div className="pin-voice-note-player"><Volume2 size={18} className="voice-note-icon"/><audio controls src={selected.voice_note_url} className="voice-note-audio">Tarayıcınız ses oynatmayı desteklemiyor.</audio></div>}
      <div className={`photo-grid ${selectedPhotos.length===1?'single-photo':''}`}>{selectedPhotos.map((photo,index)=><button key={photo.id} type="button" className="photo-tile" onClick={()=>setLightboxIndex(index)} aria-label={`Fotoğraf ${index+1} / ${selectedPhotos.length} büyüt`}><img src={photoUrls[photo.storage_path]||''} alt={`Konum fotoğrafı ${index+1}`} loading="lazy"/></button>)}</div>
      <div className="selected-address"><MapPin size={17} aria-hidden="true"/><span>{selectedAddress||`${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}`}</span></div><p className="coordinates selected-coordinates">{selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}</p>
      <div className="pin-interactions-row"><div className="pin-reactions-bar"><div className="reaction-group">{['🚓','🧑‍✈️','🚒','👮‍♂️','🚧'].map(emoji=>{const count=reactions.filter(r=>r.emoji===emoji).length;const isMine=reactions.some(r=>r.user_id===session?.user?.id&&r.emoji===emoji);return <button key={emoji} type="button" className={`reaction-btn ${isMine?'is-active':''}`} onClick={()=>onToggleReaction(emoji)} disabled={!session?.user}><span>{emoji}</span>{count>0&&<span>{count}</span>}</button>;})}</div><div className="reaction-group weather-group">{['☀️','🌧️','❄️','☁️','⛈️'].map(emoji=>{const count=reactions.filter(r=>r.emoji===emoji).length;const isMine=reactions.some(r=>r.user_id===session?.user?.id&&r.emoji===emoji);return <button key={emoji} type="button" className={`reaction-btn weather-btn ${isMine?'is-active':''}`} onClick={()=>onToggleReaction(emoji)} disabled={!session?.user}><span>{emoji}</span>{count>0&&<span>{count}</span>}</button>;})}</div></div>
        {(()=>{const votes=selected.pin_votes??[];const score=votes.reduce((sum:number,vote:any)=>sum+Number(vote.vote_type||0),0);const myVote=session?.user?.id?votes.find((vote:any)=>vote.user_id===session.user.id)?.vote_type??0:0;const ownPin=!!session?.user?.id&&selected.owner_id===session.user.id;return <div className="pin-vote-bar" aria-label={`Toplam oy skoru: ${score}`}><button type="button" className={`pin-vote-button vote-up ${myVote===1?'is-active':''}`} aria-label="Artı oy ver" aria-pressed={myVote===1} disabled={!session?.user||ownPin||busy} onClick={()=>onToggleVote(1)}>+</button><strong className={`pin-vote-score ${score>0?'score-positive':score<0?'score-negative':''}`}>{score>0?`+${score}`:score}</strong><button type="button" className={`pin-vote-button vote-down ${myVote===-1?'is-active':''}`} aria-label="Eksi oy ver" aria-pressed={myVote===-1} disabled={!session?.user||ownPin||busy} onClick={()=>onToggleVote(-1)}>−</button></div>;})()}
      </div>
      <div className="pin-comments-section"><h3 className="comments-title">Yorumlar ({comments.length})</h3><div className="comments-list">{comments.length===0&&<p className="comments-empty">Henüz yorum yok. İlk yorumu sen yap!</p>}{comments.map(c=><div key={c.id} className="comment-item"><div className="comment-header"><strong>{c.profiles?.username||'Kullanıcı'}</strong><small>{relativeTime(c.created_at)}</small></div><p className="comment-text">{c.content}</p></div>)}</div>{session?.user&&<form className="comment-form" onSubmit={onSubmitComment}><input value={newComment} onChange={e=>setNewComment(e.target.value)} placeholder="Bir yorum yaz..." maxLength={500}/><button type="submit" disabled={busyComment||!newComment.trim()}>{busyComment?'...':'Gönder'}</button></form>}</div>
      <div style={{display:'flex',flexDirection:'column',gap:'10px',marginTop:'20px'}}><a className="directions-link" href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`} target="_blank" rel="noopener noreferrer" style={{textAlign:'center',width:'100%',display:'block'}}>Yol tarifi</a>{session?.user&&<button type="button" className="primary-button" style={{width:'100%',display:'flex',justifyContent:'center',alignItems:'center',padding:'10px'}} onClick={()=>onBuildRoute(selected)}><Navigation size={16} style={{marginRight:'8px'}}/> Buraya Rota Oluştur</button>}{canDeleteSelected&&<div className="pin-owner-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onBeginEdit}>Düzenle</button><button type="button" className="delete-pin-button" disabled={busy} onClick={()=>onDelete(selected.id)}><X size={16}/>{busy?'Siliniyor…':'Bu Noktayı Sil'}</button></div>}{session?.user&&!canDeleteSelected&&<button type="button" className="secondary-button" style={{width:'100%',display:'flex',justifyContent:'center',alignItems:'center',color:'#ef4444',borderColor:'rgba(239, 68, 68, 0.5)',padding:'10px'}} onClick={()=>onReport(selected)}><ShieldAlert size={16} style={{marginRight:'8px'}}/> Bu Noktayı Rapor Et</button>}</div>
    </>
  );
}
