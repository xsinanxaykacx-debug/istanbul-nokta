import { Clock, MapPin, Navigation, Search } from 'lucide-react';

type Props = {
  filteredListPins: any[];
  timeFilter: string;
  filteredPins: any[];
  selectedCategoryFilter: string;
  debouncedQuery: string;
  routeMode: boolean;
  routeInfo: any;
  routeOrderedPins: any[];
  pins: any[];
  canAdd: boolean;
  session: any;
  onAddAccount: () => void;
  selectedId: string | null;
  pinAddresses: Record<string, string>;
  photoUrls: Record<string, string>;
  thumbFailed: Record<string, boolean>;
  ensurePhotoUrls: (paths: string[]) => void;
  onThumbError: (pinId: string) => void;
  onSelectPin: (pin: any) => void;
  categoryClass: (category?: string | null) => string;
  normalizeCategory: (category?: string | null) => string;
  categoryFilterColors: Record<string, string>;
  LazyPinThumbnail: any;
  formatRouteDistance: (meters: number) => string;
  relativeTime: (iso: string) => string;
  pinTitle: (pin: any) => string;
};

export default function PinList(props: Props) {
  const {filteredListPins,timeFilter,filteredPins,selectedCategoryFilter,debouncedQuery,routeMode,routeInfo,routeOrderedPins,pins,canAdd,onAddAccount,selectedId,pinAddresses,photoUrls,thumbFailed,ensurePhotoUrls,onThumbError,onSelectPin,categoryClass,normalizeCategory,categoryFilterColors,LazyPinThumbnail,formatRouteDistance,relativeTime,pinTitle}=props;
  return (
    <>
      {filteredListPins.length===0&&timeFilter!=='all'&&filteredPins.length===0?<><div className="empty-icon"><Clock size={24}/></div><h2>Bu zaman aralığında nokta yok</h2><p>Daha geniş bir zaman aralığı seçebilir veya tüm son 24 saati görüntüleyebilirsin.</p></>:filteredListPins.length===0&&selectedCategoryFilter!=='Tümü'&&filteredPins.length===0?<><div className="empty-icon"><MapPin size={24}/></div><h2>Bu kategoride henüz nokta yok</h2><p>Başka bir kategori seçebilir veya yeni bir nokta ekleyebilirsin.</p></>:filteredListPins.length===0&&debouncedQuery.trim()?<><div className="empty-icon"><Search size={24}/></div><h2>Eşleşen nokta yok</h2><p>Farklı bir kelimeyle tekrar ara.</p></>:routeMode&&routeInfo&&routeOrderedPins.length===0?<><div className="empty-icon"><Navigation size={24}/></div><h2>Güzergâhta nokta yok</h2><p>Rota çizgisinin 100 metre yakınında paylaşılmış nokta bulunamadı.</p></>:pins.length===0?<><div className="empty-icon"><MapPin size={24}/></div><h2>İstanbul haritası</h2><p>{canAdd?'Haritada bir noktaya tıklayarak yeni paylaşım oluştur.':'Haritayı gezebilirsin.'}</p></>:<div className="pin-list" aria-label="Paylaşılan noktalar">{routeOrderedPins.map(({pin,routeOrder,routeDistance})=>{const first=[...(pin.pin_photos??[])].sort((a:any,b:any)=>a.sort_order-b.sort_order)[0];const title=pinTitle(pin);const score=pin.pin_votes?.reduce((sum:number,v:any)=>sum+v.vote_type,0)||0;return <button key={pin.id} type="button" className={`pin-list-item ${routeOrder!==null?'route-stop-item':''} ${selectedId===pin.id?'is-selected':''}`} aria-label={routeOrder!==null?`${routeOrder}. durak: ${title}, haritada göster`:`Aç: ${title}`} onClick={()=>onSelectPin(pin)}>{routeOrder!==null&&<span className="route-stop-number">{routeOrder}</span>}<div className="pin-list-left"><span className="pin-thumb">{first&&!thumbFailed[pin.id]?<LazyPinThumbnail path={first.storage_path} url={photoUrls[first.storage_path]} onVisible={ensurePhotoUrls} onError={()=>onThumbError(pin.id)} category={pin.category}/>:<span className="mini-pin"><MapPin size={16} style={{stroke:categoryFilterColors[normalizeCategory(pin.category)],color:categoryFilterColors[normalizeCategory(pin.category)]}}/></span>}</span><small className={`pin-category-label ${categoryClass(pin.category)}`}><span className="pin-category-dot"/>{normalizeCategory(pin.category)}</small></div><div className="pin-list-right"><strong className="pin-list-title" title={pinAddresses[pin.id]||title}>{pinAddresses[pin.id]||title||'Adres aranıyor...'}</strong><div className="pin-list-meta"><small>{routeDistance!==null?`${formatRouteDistance(routeDistance)} · `:''}{relativeTime(pin.created_at)} · {pin.pin_photos?.length??0} fotoğraf</small><span className={`pin-score-badge ${score>0?'score-pos':score<0?'score-neg':'score-zero'}`} aria-label={`Oy skoru: ${score}`}>{score>0?`+${score}`:score}</span></div></div></button>;})}</div>}
      {!props.session&&<button className="secondary-button full-width" onClick={onAddAccount}>Hesap oluştur</button>}
    </>
  );
}
