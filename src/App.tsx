import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, LocateFixed, LoaderCircle, LogIn, LogOut, MapPin, Mic, Moon, Navigation, Plus, Radar, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, Sun, UserRound, X, BrainCircuit } from 'lucide-react';
import { isConfigured, supabase } from './lib/supabase';
import { compressPhoto } from './lib/photos';
import { containsProfanity } from './lib/moderation';
import type { MLCEngine } from "@mlc-ai/web-llm";
import Map3D from './Map3D';

type Profile = { id: string; status: 'pending'|'active'|'disabled'; role: 'user'|'admin'; username: string | null };
type InviteCode = { id: string; code: string | null; created_at: string; redeemed_at: string | null; is_enabled: boolean };
type PinPhoto = { id: string; storage_path: string; public_url: string; sort_order: number };
type PinVote = { vote_type: number; user_id: string };
type Pin = { id: string; owner_id: string; lat: number; lng: number; description: string; created_at: string; category: string | null; pin_photos: PinPhoto[]; pin_votes: PinVote[] };
type Notice = { kind: 'success'|'error'|'info'; text: string };
type PlaceResult = { place_id: number; lat: string; lon: string; display_name: string; address?: Record<string,string> };
type SpeechSetter = (value: string | ((current: string) => string)) => void;
type SpeechRecognitionInstance = { lang: string; interimResults: boolean; maxAlternatives: number; onstart: (() => void) | null; onresult: ((event: any) => void) | null; onerror: ((event: any) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };

const TELEGRAM_PIN_MARKER = '[AYTAR-RADAR]';
const TELEGRAM_OWNER_ID_PREFIX = 'a09a270f-';

function createNeonPinSvg(color: string, inner: string): string {
  const path = 'M24 2C12.4 2 3 11.4 3 23c0 14.6 21 34 21 34s21-19.4 21-34C45 11.4 35.6 2 24 2Z';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 48 58" overflow="visible"><defs><filter id="neonGlow" x="-60%" y="-50%" width="220%" height="220%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="3.2" result="blur"/><feFlood flood-color="${color}" flood-opacity="1" result="neonColor"/><feComposite in="neonColor" in2="blur" operator="in" result="neonBlur"/><feMerge><feMergeNode in="neonBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="${path}" fill="#0f172a" fill-opacity="0.94" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" filter="url(#neonGlow)"/>${inner}</svg>`;
}

function createNeonLetter(color: string, letter: string): string {
  return `<text x="24" y="24" fill="${color}" stroke="${color}" stroke-width="0.45" paint-order="stroke" filter="url(#neonGlow)" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="400" text-anchor="middle" dominant-baseline="central">${letter}</text>`;
}

const pinIcons: Record<string, L.DivIcon> = {
  'YEŞİL': new L.DivIcon({ className: 'pin-icon-wrap', html: `<div class="neon-pin-icon">${createNeonPinSvg('#39FF14', createNeonLetter('#39FF14', 'Y'))}</div>`, iconSize: [32, 40], iconAnchor: [16, 38] }),
  'MAVİ': new L.DivIcon({ className: 'pin-icon-wrap', html: `<div class="neon-pin-icon">${createNeonPinSvg('#00E5FF', createNeonLetter('#00E5FF', 'M'))}</div>`, iconSize: [32, 40], iconAnchor: [16, 38] }),
  'KIRMIZI': new L.DivIcon({ className: 'pin-icon-wrap', html: `<div class="neon-pin-icon">${createNeonPinSvg('#FF1744', createNeonLetter('#FF1744', 'K'))}</div>`, iconSize: [32, 40], iconAnchor: [16, 38] }),
  'SARI': new L.DivIcon({ className: 'pin-icon-wrap', html: `<div class="neon-pin-icon">${createNeonPinSvg('#FFEA00', createNeonLetter('#FFEA00', 'S'))}</div>`, iconSize: [32, 40], iconAnchor: [16, 38] }),
};

const telegramPinIcon = new L.DivIcon({
  className: 'pin-icon-wrap telegram-pin-icon-wrap',
  html: `<div class="neon-pin-icon">${createNeonPinSvg('#B026FF', '<circle cx="24" cy="22" r="10.5" fill="none" stroke="#B026FF" stroke-width="1.8" filter="url(#neonGlow)"/><path d="M24 11.5v10.5l7 4M16 15l16 14M32 15 16 29" fill="none" stroke="#B026FF" stroke-width="1.7" stroke-linecap="round" filter="url(#neonGlow)"/><circle cx="24" cy="22" r="2.5" fill="#0f172a" stroke="#B026FF" stroke-width="1.5" filter="url(#neonGlow)"/>')}</div>`,
  iconSize: [32, 40],
  iconAnchor: [16, 38],
});

function isTelegramPin(description?: string | null, ownerId?: string | null): boolean {
  return (
    (typeof ownerId === 'string' && ownerId.toLowerCase().startsWith(TELEGRAM_OWNER_ID_PREFIX)) ||
    (typeof description === 'string' && description.startsWith(`${TELEGRAM_PIN_MARKER} `))
  );
}

function pinDescription(pin: Pick<Pin, 'description'>): string {
  return isTelegramPin(pin.description)
    ? pin.description.slice(TELEGRAM_PIN_MARKER.length).trimStart()
    : pin.description;
}

const categoryFilterColors: Record<string, string> = {
  'Tümü': '#f97316', 'YEŞİL': '#39FF14', 'MAVİ': '#00E5FF', 'KIRMIZI': '#FF1744', 'SARI': '#FFEA00', 'BENIM': '#8b5cf6',
};

function normalizeCategory(category?: string | null): string {
  switch (category) {
    case 'YEŞİL': case 'Yeşiller': case 'Yeşil': return 'YEŞİL';
    case 'MAVİ': case 'Maviler': case 'Mavi': return 'MAVİ';
    case 'GRİ': case 'SARI': case 'Siviller': case 'Sivil': case 'Sarı': case 'Sarılar': return 'SARI';
    case 'KIRMIZI': case 'Hepsi': case null: case undefined: return 'KIRMIZI';
    default: return 'KIRMIZI';
  }
}
function categoryClass(category?: string | null): string {
  const normalized = normalizeCategory(category);
  return `category-${normalized === 'YEŞİL' ? 'yesil' : normalized === 'MAVİ' ? 'mavi' : normalized === 'SARI' ? 'sari' : 'kirmizi'}`;
}
function getPinIcon(category?: string | null, description?: string | null, ownerId?: string | null): L.DivIcon { return isTelegramPin(description, ownerId) ? telegramPinIcon : pinIcons[normalizeCategory(category)]; }

const draftPinIcon = new L.DivIcon({ className:'draft-pin-icon-wrap', html:'<div class="draft-pin-target"><span class="draft-pin-halo"></span><div class="pin-icon"><span></span></div></div>', iconSize:[44,50], iconAnchor:[22,48] });
const userLocationIcon = new L.DivIcon({ className:'user-location-marker', html:'<span class="user-location-dot"></span>', iconSize:[24,24], iconAnchor:[12,12] });
const searchPlaceIcon = new L.DivIcon({ className:'search-place-marker', html:'<span class="search-place-dot"></span>', iconSize:[30,30], iconAnchor:[15,15] });
const tomtomApiKey = import.meta.env.VITE_TOMTOM_API_KEY?.trim() ?? '';
const routeStartIcon = new L.DivIcon({ className:'route-marker-wrap', html:'<span class="route-marker route-marker-start">A</span>', iconSize:[30,30], iconAnchor:[15,15] });
const routeEndIcon = new L.DivIcon({ className:'route-marker-wrap', html:'<span class="route-marker route-marker-end">B</span>', iconSize:[30,30], iconAnchor:[15,15] });

function haversineMeters(a:[number,number],b:[number,number]):number {
  const radians=(degrees:number)=>degrees*Math.PI/180;
  const dLat=radians(b[0]-a[0]); const dLng=radians(b[1]-a[1]);
  const h=Math.sin(dLat/2)**2+Math.cos(radians(a[0]))*Math.cos(radians(b[0]))*Math.sin(dLng/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
function routePositionForPin(pin:Pick<Pin,'lat'|'lng'>,line:[number,number][]):{distanceMeters:number;alongRouteMeters:number} {
  let bestDistance=Number.POSITIVE_INFINITY; let bestAlong=0; let traversed=0;
  const radians=(degrees:number)=>degrees*Math.PI/180;
  for(let index=0;index<line.length-1;index++){
    const start=line[index]; const end=line[index+1];
    const latitudeScale=111320; const longitudeScale=111320*Math.cos(radians((start[0]+end[0]+pin.lat)/3));
    const ax=(start[1]-pin.lng)*longitudeScale; const ay=(start[0]-pin.lat)*latitudeScale;
    const bx=(end[1]-pin.lng)*longitudeScale; const by=(end[0]-pin.lat)*latitudeScale;
    const dx=bx-ax; const dy=by-ay; const lengthSquared=dx*dx+dy*dy;
    const fraction=lengthSquared===0?0:Math.max(0,Math.min(1,-(ax*dx+ay*dy)/lengthSquared));
    const distance=Math.hypot(ax+fraction*dx,ay+fraction*dy);
    const segmentLength=haversineMeters(start,end);
    if(distance<bestDistance){bestDistance=distance;bestAlong=traversed+fraction*segmentLength;}
    traversed+=segmentLength;
  }
  return {distanceMeters:bestDistance,alongRouteMeters:bestAlong};
}
function formatRouteDistance(meters:number):string { return meters>=1000?`${(meters/1000).toLocaleString('tr-TR',{maximumFractionDigits:1})} km`:`${Math.round(meters)} m`; }
function formatRouteDuration(seconds:number):string {
  const minutes=Math.max(1,Math.round(seconds/60));
  if(minutes<60)return `${minutes} dk`;
  const hours=Math.floor(minutes/60); const remaining=minutes%60;
  return remaining?`${hours} sa ${remaining} dk`:`${hours} sa`;
}
function pinTitle(pin: Pin) { return pinDescription(pin).trim().split(/\r?\n/)[0].slice(0, 90) || 'Açıklamasız konum'; }
function pinMarkerTitle(pin: Pin) { return isTelegramPin(pin.description, pin.owner_id) ? `AYTAR RADAR · ${pinTitle(pin)}` : pinTitle(pin); }
function relativeTime(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (elapsed < 60000) return 'az önce';
  const minutes = Math.floor(elapsed / 60000); if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours} saat önce`;
  return new Date(iso).toLocaleDateString('tr-TR');
}

function HeatmapLayer({ pins }: { pins: Pin[] }) {
  const map = useMap();
  useEffect(() => {
    if (!pins || pins.length === 0) return;
    const points = pins.map(p => [p.lat, p.lng, 1]);
    const heat = (L as any).heatLayer(points, {
      radius: 35, blur: 20, maxZoom: 15, minOpacity: 0.6,
      gradient: { 0.4: 'blue', 0.6: 'cyan', 0.7: 'lime', 0.8: 'yellow', 1.0: 'red' }
    });
    heat.addTo(map);
    return () => { map.removeLayer(heat); };
  }, [map, pins]);
  return null;
}

function MapClick({ enabled, routeMode, onRoutePick, onPick, onMapClick }: { enabled:boolean; routeMode:boolean; onRoutePick:(lat:number,lng:number)=>void; onPick:(lat:number,lng:number)=>void; onMapClick:()=>void }) { useMapEvents({ click(e) { onMapClick(); if(routeMode){onRoutePick(e.latlng.lat,e.latlng.lng);return;} if (enabled) onPick(e.latlng.lat,e.latlng.lng); } }); return null; }
function ViewportWatcher({ onBoundsChange }: { onBoundsChange: (bounds: [number, number, number, number]) => void }) {
  const map = useMapEvents({ moveend: () => schedule(), zoomend: () => schedule() });
  const timerRef = useRef<number | undefined>(undefined); const lastRef = useRef<string>('');
  const publish = useCallback(() => {
    const bounds = map.getBounds();
    const next: [number, number, number, number] = [bounds.getSouth(), bounds.getNorth(), bounds.getWest(), bounds.getEast()];
    const key = next.map(value => value.toFixed(5)).join(':');
    if (key === lastRef.current) return; lastRef.current = key; onBoundsChange(next);
  }, [map, onBoundsChange]);
  const schedule = useCallback(() => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(publish, 300);
  }, [publish]);
  useEffect(() => { publish(); return () => { if (timerRef.current !== undefined) window.clearTimeout(timerRef.current); }; }, [publish]);
  return null;
}
function FlyTo({ position, zoom }: { position:[number,number]|null; zoom?:number }) { const map=useMap(); useEffect(()=>{ if(position) map.flyTo(position,zoom??Math.max(map.getZoom(),14),{duration:.5}); },[map,position,zoom]); return null; }

function ClusteredPins({ pins, selectedId, isDimmed, onSelect }: { pins: Pin[]; selectedId: string | null; isDimmed: (pin: Pin) => boolean; onSelect: (pin: Pin) => void }) {
  const [, setRevision] = useState(0);
  const map = useMapEvents({ zoomend: () => setRevision(v => v + 1), moveend: () => setRevision(v => v + 1) });
  const zoom = map.getZoom(); const cells = new Map<string, Pin[]>();
  for (const pin of pins) {
    if (zoom >= 17 || pin.id === selectedId) { cells.set(`single:${pin.id}`, [pin]); continue; }
    const point = map.project([pin.lat, pin.lng], zoom);
    const key = `cell:${Math.floor(point.x / 56)}:${Math.floor(point.y / 56)}`;
    const cell = cells.get(key); if (cell) cell.push(pin); else cells.set(key, [pin]);
  }
  return <>{Array.from(cells.entries()).map(([key, group]) => {
    if (group.length === 1) {
      const pin = group[0];
      return <Marker key={pin.id} position={[pin.lat, pin.lng]} icon={getPinIcon(pin.category, pin.description, pin.owner_id)} opacity={isDimmed(pin) ? 0.35 : 1} title={pinMarkerTitle(pin)} alt={pinMarkerTitle(pin)} keyboard eventHandlers={{ click: () => onSelect(pin) }} />;
    }
    const center: [number, number] = [group.reduce((sum, pin) => sum + pin.lat, 0) / group.length, group.reduce((sum, pin) => sum + pin.lng, 0) / group.length];
    const clusterIcon = L.divIcon({ className: 'pin-cluster-icon-wrap', html: `<div class="pin-cluster-icon"><span>${group.length}</span></div>`, iconSize: [44, 44], iconAnchor: [22, 22] });
    return <Marker key={key} position={center} icon={clusterIcon} opacity={group.some(pin => !isDimmed(pin)) ? 1 : 0.35} alt={`${group.length} işaretçi içeren grup`} title={`${group.length} işaretçi — yakınlaştırmak için tıkla`} keyboard eventHandlers={{ click: () => { const bounds = L.latLngBounds(group.map(pin => [pin.lat, pin.lng] as L.LatLngTuple)); if (bounds.getNorthEast().equals(bounds.getSouthWest())) { map.flyTo(center, Math.min(18, zoom + 3), { duration: 0.4 }); } else { map.fitBounds(bounds, { padding: [36, 36], maxZoom: Math.min(18, zoom + 3), animate: true }); } } }} />;
  })}</>;
}

function LazyPinThumbnail({ path, url, onVisible, onError, category }: { path:string; url?:string; onVisible:(paths:string[])=>void; onError:()=>void; category: string | null }) {
  const ref=useRef<HTMLSpanElement|null>(null);
  useEffect(()=>{const element=ref.current;if(!element)return;let done=false;const load=()=>{if(done)return;done=true;onVisible([path]);};if(typeof IntersectionObserver==='undefined'){load();return;}const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){load();observer.disconnect();}},{rootMargin:'100px'});observer.observe(element);return()=>observer.disconnect();},[path,onVisible]);
  return <span ref={ref} className="pin-thumb-image-slot">
    {url ? (
      <img src={url} alt="" loading="lazy" decoding="async" onError={onError}/>
    ) : (
      <span className="mini-pin">
        <MapPin size={16} style={{ stroke: categoryFilterColors[normalizeCategory(category)], color: categoryFilterColors[normalizeCategory(category)] }} />
      </span>
    )}
  </span>;
}

export default function App() {
  const [session,setSession]=useState<any>(null); const [profile,setProfile]=useState<Profile|null>(null); const [pins,setPins]=useState<Pin[]>([]); const [viewportBounds,setViewportBounds]=useState<[number,number,number,number]|null>(null); const lastSyncAtRef=useRef<string>(''); const loadRequestRef=useRef(0); const [selected,setSelected]=useState<Pin|null>(null); const [editPinMode,setEditPinMode]=useState(false); const [editDescription,setEditDescription]=useState(''); const [editCategory,setEditCategory]=useState('KIRMIZI'); const [editPhotos,setEditPhotos]=useState<PinPhoto[]>([]); const [editFiles,setEditFiles]=useState<File[]>([]); const [editError,setEditError]=useState<string|null>(null); const [showTraffic,setShowTraffic]=useState(false); const [showHeatmap,setShowHeatmap]=useState(false); const [isDarkMode,setIsDarkMode]=useState(true); const [is3D, setIs3D] = useState(false); const [routeMode,setRouteMode]=useState(false); const [routeStart,setRouteStart]=useState<[number,number]|null>(null); const [routeEnd,setRouteEnd]=useState<[number,number]|null>(null); const [routeLine,setRouteLine]=useState<[number,number][]|null>(null); const [routeInfo,setRouteInfo]=useState<{distance:string;duration:string;pinsOnRoute:string[]}|null>(null); const [routeLoading,setRouteLoading]=useState(false); const [routeError,setRouteError]=useState<string|null>(null);
  const [debouncedQuery,setDebouncedQuery]=useState(''); const [searchResultIds,setSearchResultIds]=useState<string[]|null>(null); const [photoUrls,setPhotoUrls]=useState<Record<string,string>>({}); const [pinAddresses,setPinAddresses]=useState<Record<string,string>>({}); const pinAddressesRef=useRef<Record<string,string>>({}); const visiblePinsRef=useRef<Pin[]>([]); const addressRequestRef=useRef<{pinId:string;controller:AbortController}|null>(null); const addressQueueWakeRef=useRef<(() => void)|null>(null); const addressAttemptedRef=useRef<Set<string>>(new Set()); const [lightboxIndex,setLightboxIndex]=useState<number|null>(null); const [thumbFailed,setThumbFailed]=useState<Record<string,boolean>>({});
  const [authMode,setAuthMode]=useState<'login'|'signup'>('login'); const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
  const [selectedAddress,setSelectedAddress]=useState<string|null>(null); const [placeQuery,setPlaceQuery]=useState(''); const [placeResults,setPlaceResults]=useState<PlaceResult[]>([]); const [placeLoading,setPlaceLoading]=useState(false); const [placeSearched,setPlaceSearched]=useState(false); const [placeDropdownOpen,setPlaceDropdownOpen]=useState(false); const [searchPlace,setSearchPlace]=useState<PlaceResult|null>(null);
  const [description,setDescription]=useState(''); const hasProfanity=containsProfanity(description); const [category,setCategory]=useState('KIRMIZI'); const [selectedCategoryFilter,setSelectedCategoryFilter]=useState('Tümü'); const [showFilterOptions,setShowFilterOptions]=useState(false); const [timeFilter,setTimeFilter]=useState<string>('all'); const [files,setFiles]=useState<File[]>([]); const [draftPosition,setDraftPosition]=useState<[number,number]|null>(null); const [userPosition,setUserPosition]=useState<[number,number]|null>(null); const [locating,setLocating]=useState(false); const [notice,setNotice]=useState<Notice|null>(null); const [busy,setBusy]=useState(false); const [query,setQuery]=useState(''); const [authOpen,setAuthOpen]=useState(false); const [profileMenuOpen,setProfileMenuOpen]=useState(false); const [inviteOpen,setInviteOpen]=useState(false); const [inviteCodes,setInviteCodes]=useState<InviteCode[]>([]); const [copiedCodeId,setCopiedCodeId]=useState<string|null>(null); const [speechSupported,setSpeechSupported]=useState(false); const [listeningField,setListeningField]=useState<string|null>(null); const recognitionRef=useRef<SpeechRecognitionInstance|null>(null); const [voicePinListening,setVoicePinListening]=useState(false); const [voicePinHintVisible,setVoicePinHintVisible]=useState(true); const voicePinRecognitionRef=useRef<SpeechRecognitionInstance|null>(null); const voicePinTimeoutRef=useRef<number|undefined>(undefined);
  const manualStopRef = useRef(false);
  const mapRef = useRef<L.Map | null>(null);
  const [flyToUserCoords, setFlyToUserCoords] = useState<[number, number] | null>(null); // YENİ EKLENDİ

  const [llmEngine, setLlmEngine] = useState<MLCEngine | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const llmEngineRef = useRef<MLCEngine | null>(null);
  const llmLoadPromiseRef = useRef<Promise<MLCEngine | null> | null>(null);

  const [adminOpen, setAdminOpen] = useState(false);
  const [adminProfiles, setAdminProfiles] = useState<any[]>([]);
  const [adminReports, setAdminReports] = useState<any[]>([]);
  const [adminTab, setAdminTab] = useState<'users'|'reports'>('users');
  const [adminLoading, setAdminLoading] = useState(false);
  
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [bulkSelectedPins, setBulkSelectedPins] = useState<string[]>([]);

  const draftPositionRef = useRef(draftPosition); const categoryRef = useRef(category); const descriptionRef = useRef(description); const filesRef = useRef(files);
  useEffect(() => { draftPositionRef.current = draftPosition; }, [draftPosition]);
  useEffect(() => { categoryRef.current = category; }, [category]);
  useEffect(() => { descriptionRef.current = description; }, [description]);
  useEffect(() => { filesRef.current = files; }, [files]);
  
  const active=profile?.status==='active'; const canSeePins=active; const canAdd=active; const canDeleteSelected=!!selected&&!!session?.user?.id&&(selected.owner_id===session.user.id||profile?.role==='admin');
  
  const matchingIds=useMemo(()=>new Set(searchResultIds??pins.map(p=>p.id)),[searchResultIds,pins]);
  const filteredPins=useMemo(()=>{
    const userId=session?.user?.id;
    const categoryPins=selectedCategoryFilter==='Tümü'
      ? pins
      : selectedCategoryFilter==='BENIM'
        ? (userId ? pins.filter(pin=>pin.owner_id===userId) : [])
        : pins.filter(pin=>normalizeCategory(pin.category)===selectedCategoryFilter);
    if(timeFilter==='all')return categoryPins;
    const durationByFilter:Record<string,number>={'1m':60_000,'15m':15*60_000,'30m':30*60_000,'1h':60*60_000,'6h':6*60*60_000,'12h':12*60*60_000};
    const duration=durationByFilter[timeFilter];
    if(!duration)return categoryPins;
    const now=Date.now();
    return categoryPins.filter(pin=>{
      const createdAt=new Date(pin.created_at).getTime();
      const age=now-createdAt;
      return Number.isFinite(createdAt)&&age>=0&&age<duration;
    });
  },[pins,selectedCategoryFilter,timeFilter,session?.user?.id]);
  const filteredListPins=useMemo(()=>{const searched=!debouncedQuery.trim()||searchResultIds===null?filteredPins:filteredPins.filter(pin=>searchResultIds.includes(pin.id));if(routeInfo)return searched.filter(pin=>routeInfo.pinsOnRoute.includes(pin.id));return searched;},[filteredPins,debouncedQuery,searchResultIds,routeInfo]);

  // Keep the coordinate array stable across unrelated renders; otherwise Map3D's flyTo effect re-runs.
  const flyToCoords=useMemo<[number,number]|null>(() => {
    if (searchPlace) return [Number(searchPlace.lon), Number(searchPlace.lat)];
    if (selected) return [Number(selected.lng), Number(selected.lat)];
    return null;
  }, [searchPlace?.lon, searchPlace?.lat, selected?.lng, selected?.lat]);
  
  const routeOrderedPins=useMemo(()=>{
    if(!routeMode||!routeInfo||!routeLine)return filteredListPins.map(pin=>({pin,routeOrder:null as number|null,routeDistance:null as number|null}));
    return filteredListPins.map(pin=>({pin,position:routePositionForPin(pin,routeLine)})).filter(item=>item.position.distanceMeters<=100).sort((a,b)=>a.position.alongRouteMeters-b.position.alongRouteMeters).map((item,index)=>({pin:item.pin,routeOrder:index+1,routeDistance:item.position.alongRouteMeters}));
  },[filteredListPins,routeMode,routeInfo,routeLine]);
  
  const visiblePins=useMemo(()=>{const inViewport=viewportBounds?(()=>{const [minLat,maxLat,minLng,maxLng]=viewportBounds;return filteredPins.filter(pin=>pin.lat>=minLat&&pin.lat<=maxLat&&pin.lng>=minLng&&pin.lng<=maxLng);})():filteredPins;if(selected&&filteredPins.some(pin=>pin.id===selected.id)&&!inViewport.some(pin=>pin.id===selected.id))return [...inViewport,selected];return inViewport;},[filteredPins,viewportBounds,selected]);
  const ensurePhotoUrls=useCallback((paths:string[])=>{if(!supabase||!paths.length)return;const urls:Record<string,string>={};for(const path of new Set(paths)){const {data}=supabase.storage.from('pin-photos').getPublicUrl(path);if(data.publicUrl)urls[path]=data.publicUrl;}if(Object.keys(urls).length)setPhotoUrls(prev=>({...prev,...urls}));},[]);
  const loadProfile=useCallback(async(userId:string)=>{if(!supabase)return;const {data,error}=await supabase.from('profiles').select('id,status,role,username').eq('id',userId).maybeSingle();if(error){setNotice({kind:'error',text:`Profil okunamadı: ${error.message}`});setProfile(null);return;}setProfile(data as Profile|null);},[]);

  const loadPins=useCallback(async(silentOrOptions:boolean|{silent?:boolean;incremental?:boolean}=false)=>{
    const options=typeof silentOrOptions==='boolean'?{silent:silentOrOptions,incremental:false}:silentOrOptions;
    const silent=options.silent===true;
    if(!supabase||!canSeePins){setPins([]);setSelected(null);setSearchResultIds(null);return;}
    const requestId=++loadRequestRef.current;
    try{
      const cutoff=new Date(Date.now()-24*60*60*1000).toISOString(); const rows:Pin[]=[]; const pageSize=500; let offset=0;
      const incremental=!!options.incremental&&!!lastSyncAtRef.current; const since=incremental?new Date(new Date(lastSyncAtRef.current).getTime()-2000).toISOString():null;
      while(true){
        let query=supabase.from('pins').select('id,owner_id,lat,lng,description,category,created_at,pin_photos(id,storage_path,public_url,sort_order),pin_votes(vote_type,user_id)').gte('created_at',cutoff).order('created_at',{ascending:false}).range(offset,offset+pageSize-1);
        if(since)query=query.gt('created_at',since);
        const {data,error}=await query;
        if(error){if(silent)console.warn('Pinler yüklenemedi:',error);else setNotice({kind:'error',text:'Bağlantı sorunu yaşanıyor, lütfen tekrar deneyin.'});return;}
        const batch=(data??[]) as unknown as Pin[];rows.push(...batch);
        if(batch.length<pageSize)break;offset+=batch.length;
      }
      if(requestId!==loadRequestRef.current)return;
      if(incremental){ setPins(current=>{const byId=new Map(current.map(pin=>[pin.id,pin]));for(const row of rows)byId.set(row.id,{...byId.get(row.id),...row,pin_photos:row.pin_photos?.length?row.pin_photos:(byId.get(row.id)?.pin_photos??[])});return [...byId.values()].filter(pin=>pin.created_at>=cutoff).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));}); }
      else{ setPins(rows); setSelected(current=>current&&!rows.some(pin=>pin.id===current.id)?null:current); }
      lastSyncAtRef.current=new Date().toISOString();
    }catch(error){console.warn('Pinler yüklenemedi:',error);if(!silent)setNotice({kind:'error',text:'Bağlantı sorunu yaşanıyor, lütfen tekrar deneyin.'});}
  },[canSeePins]);

  useEffect(()=>{const speechWindow=window as Window & {SpeechRecognition?:new()=>SpeechRecognitionInstance;webkitSpeechRecognition?:new()=>SpeechRecognitionInstance};setSpeechSupported(!!(speechWindow.SpeechRecognition||speechWindow.webkitSpeechRecognition));return()=>{recognitionRef.current?.stop();};},[]);
  useEffect(()=>{const hintTimeout=window.setTimeout(()=>setVoicePinHintVisible(false),4000);return()=>window.clearTimeout(hintTimeout);},[]);
  useEffect(()=>{if(!supabase)return;supabase.auth.getSession().then(async({data})=>{setSession(data.session);if(data.session?.user)await loadProfile(data.session.user.id);});const {data:listener}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);if(next?.user)window.setTimeout(()=>void loadProfile(next.user.id),0);else{setProfile(null);setPins([]);setSelected(null);}});return()=>listener.subscription.unsubscribe();},[loadProfile]);
  useEffect(()=>{if(!session?.user?.id&&selectedCategoryFilter==='BENIM'){setSelectedCategoryFilter('Tümü');setShowFilterOptions(false);}},[session?.user?.id,selectedCategoryFilter]);

  useEffect(()=>{
    const userId=session?.user?.id; if(!supabase||!userId)return; const cleanupKey='lastPhotoCleanup'; const now=Date.now();
    try{ const lastRun=Number(window.localStorage.getItem(cleanupKey)||0); if(Number.isFinite(lastRun)&&lastRun>0&&now-lastRun<24*60*60*1000)return; }catch(error){ return; }
    let cancelled=false;
    const cleanupOldPhotos=async()=>{
      const cutoff=new Date(now-24*60*60*1000).toISOString(); const archivedIds:string[]=[]; let offset=0;
      while(!cancelled){
        const {data,error}=await supabase!.from('archived_pins').select('id').lt('created_at',cutoff).order('created_at',{ascending:true}).range(offset,offset+999);
        if(error)throw error; const batch=(data??[]) as Array<{id:string}>; archivedIds.push(...batch.map(pin=>pin.id));
        if(batch.length<1000)break; offset+=batch.length;
      }
      let removedCount=0;
      for(let i=0;i<archivedIds.length&&!cancelled;i+=200){
        const ids=archivedIds.slice(i,i+200); const {data,error}=await supabase!.from('pin_photos').select('storage_path').in('pin_id',ids);
        if(error)throw error; const paths=[...new Set((data??[]).map(photo=>(photo as {storage_path:string|null}).storage_path).filter((path):path is string=>!!path))];
        for(let j=0;j<paths.length&&!cancelled;j+=100){
          const {error:removeError}=await supabase!.storage.from('pin-photos').remove(paths.slice(j,j+100));
          if(removeError)throw removeError; removedCount+=Math.min(100,paths.length-j);
        }
      }
      if(!cancelled) window.localStorage.setItem(cleanupKey,String(Date.now()));
    };
    void cleanupOldPhotos().catch(()=>{});
    return()=>{cancelled=true;};
  },[session?.user?.id]);

  const loadPinsRef=useRef(loadPins); useEffect(()=>{loadPinsRef.current=loadPins;},[loadPins]); useEffect(()=>{void loadPins();},[loadPins]);
  useEffect(()=>{
    if(!session?.user?.id)return;
    const intervalId=window.setInterval(()=>{ if(document.visibilityState==='visible'){ void loadPinsRef.current({silent:true,incremental:true}); } },10000);
    const handleVisibilityChange=()=>{ if(document.visibilityState==='visible'){ void loadPinsRef.current({silent:true,incremental:true}); } };
    document.addEventListener('visibilitychange',handleVisibilityChange);
    return()=>{ window.clearInterval(intervalId); document.removeEventListener('visibilitychange',handleVisibilityChange); };
  },[session?.user?.id]);

  useEffect(()=>{
    if(!routeMode||!routeStart||!routeEnd)return;
    const controller=new AbortController(); setRouteLoading(true); setRouteError(null); setRouteLine(null); setRouteInfo(null);
    const [startLat,startLng]=routeStart; const [endLat,endLng]=routeEnd;
    const calculate=async()=>{
      try{
        let response;
        try {
          response = await fetch('/api/route',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({coordinates:[[startLng,startLat],[endLng,endLat]]})});
          if (!response.ok) throw new Error('API Fail');
        } catch (apiErr) {
          if (controller.signal.aborted) return;
          response = await fetch(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`, { signal: controller.signal });
        }
        const result=await response.json().catch(()=>null) as {routes?:Array<{geometry?:{coordinates?:number[][]};distance?:number;duration?:number}>;error?:{message?:string}|string;message?:string}|null;
        if(!response.ok){const message=typeof result?.error==='string'?result.error:result?.error?.message||result?.message||`OSRM HTTP ${response.status}`;throw new Error(message);}
        if(controller.signal.aborted)return; const route=result?.routes?.[0]; const coordinates=route?.geometry?.coordinates;
        if(!route||!coordinates||coordinates.length<2)throw new Error('OSRM geçerli bir rota döndürmedi.');
        const line=coordinates.map(point=>[point[1],point[0]] as [number,number]);
        const pinsOnRoute=pins.filter(pin=>routePositionForPin(pin,line).distanceMeters<=100).map(pin=>pin.id);
        setRouteLine(line); setRouteInfo({distance:formatRouteDistance(route.distance??0),duration:formatRouteDuration(route.duration??0),pinsOnRoute});
      }catch(error){ if(controller.signal.aborted)return; setRouteError(error instanceof Error&&error.message? `Rota hesaplanamadı: ${error.message}`:'Rota hesaplanamadı, OSRM API anahtarını kontrol edin.'); }
      finally{if(!controller.signal.aborted)setRouteLoading(false);}
    };
    void calculate(); return()=>controller.abort();
  },[routeMode,routeStart,routeEnd,pins]);

  const addressableVisiblePins=useMemo(()=>{
    if(!viewportBounds)return [];
    const [minLat,maxLat,minLng,maxLng]=viewportBounds;
    return visiblePins.filter(pin=>
      pin.lat>=minLat&&pin.lat<=maxLat&&pin.lng>=minLng&&pin.lng<=maxLng
    );
  },[visiblePins,viewportBounds]);

  useEffect(()=>{
    const visibleIds=new Set(addressableVisiblePins.map(pin=>pin.id));
    visiblePinsRef.current=addressableVisiblePins;

    // Forget failed attempts after a pin leaves view, so it can be retried when revisited.
    for(const pinId of addressAttemptedRef.current){
      if(!visibleIds.has(pinId))addressAttemptedRef.current.delete(pinId);
    }

    const activeRequest=addressRequestRef.current;
    if(activeRequest&&!visibleIds.has(activeRequest.pinId)){
      activeRequest.controller.abort();
    }
    addressQueueWakeRef.current?.();
  },[addressableVisiblePins]);

  useEffect(()=>{
    let cancelled=false;
    let delayTimer:number|undefined;
    let idleResolver:(()=>void)|null=null;

    const wake=()=>{
      const resolve=idleResolver;
      idleResolver=null;
      resolve?.();
    };
    addressQueueWakeRef.current=wake;

    const waitOneSecond=()=>new Promise<void>(resolve=>{
      delayTimer=window.setTimeout(()=>{
        delayTimer=undefined;
        resolve();
      },1000);
    });
    const waitForWork=()=>new Promise<void>(resolve=>{
      idleResolver=resolve;
    });

    const fetchAddressesSequentially=async()=>{
      while(!cancelled){
        const pin=visiblePinsRef.current.find(candidate=>
          !pinAddressesRef.current[candidate.id]&&
          !addressAttemptedRef.current.has(candidate.id)
        );
        if(!pin){
          await waitForWork();
          continue;
        }

        const controller=new AbortController();
        addressRequestRef.current={pinId:pin.id,controller};
        addressAttemptedRef.current.add(pin.id);

        try{
          const url=`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pin.lat}&lon=${pin.lng}&zoom=18&addressdetails=1&accept-language=tr`;
          const response=await fetch(url,{
            signal:controller.signal,
            headers:{'Accept':'application/json','Accept-Language':'tr'}
          });
          if(!response.ok)throw new Error(`HTTP ${response.status}`);
          const result=await response.json() as {display_name?:string;address?:Record<string,string>};

          const stillVisible=visiblePinsRef.current.some(candidate=>candidate.id===pin.id);
          if(!cancelled&&!controller.signal.aborted&&stillVisible){
            const address=result.address??{};
            const neighbourhood=address.neighbourhood||address.quarter||address.suburb||address.residential;
            const road=address.road||address.pedestrian||address.footway||address.path;
            const district=address.city_district||address.district||address.borough;
            const town=address.town||address.city||address.village||address.municipality;
            const parts:string[]=[];
            const add=(value:string|undefined)=>{if(value&&!parts.includes(value))parts.push(value);};
            if(neighbourhood)add(/mahallesi$/i.test(neighbourhood)?neighbourhood:`${neighbourhood} Mahallesi`);
            add(road);
            add(district);
            if(town!==district)add(town);
            const formatted=parts.length?parts.join(', '):result.display_name?.trim();
            if(formatted){
              pinAddressesRef.current={...pinAddressesRef.current,[pin.id]:formatted};
              setPinAddresses(current=>current[pin.id]?current:{...current,[pin.id]:formatted});
            }
          }
        }catch(error){
          if(!(error instanceof DOMException&&error.name==='AbortError')){
            console.warn('Pin adresi alınamadı:',pin.id,error);
          }
        }finally{
          if(addressRequestRef.current?.controller===controller){
            addressRequestRef.current=null;
          }
        }

        // Keep a strict minimum one-second pause between Nominatim requests,
        // including when a request is aborted after the viewport changes.
        if(!cancelled)await waitOneSecond();
      }
    };

    void fetchAddressesSequentially();
    return()=>{
      cancelled=true;
      addressRequestRef.current?.controller.abort();
      if(delayTimer!==undefined)window.clearTimeout(delayTimer);
      wake();
      if(addressQueueWakeRef.current===wake)addressQueueWakeRef.current=null;
    };
  },[]);

  useEffect(()=>{const timer=window.setTimeout(()=>setDebouncedQuery(query.trim()),250);return()=>window.clearTimeout(timer);},[query]);
  useEffect(()=>{const q=placeQuery.trim();const controller=new AbortController();if(!q){setPlaceResults([]);setPlaceLoading(false);setPlaceSearched(false);return()=>controller.abort();}setPlaceResults([]);setPlaceLoading(false);setPlaceSearched(false);const timer=window.setTimeout(()=>{setPlaceLoading(true);fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=tr&limit=5&addressdetails=1`,{signal:controller.signal,headers:{'Accept':'application/json','Accept-Language':'tr'}}).then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json() as Promise<PlaceResult[]>;}).then(results=>{setPlaceResults(Array.isArray(results)?results:[]);setPlaceSearched(true);}).catch(error=>{if(error instanceof DOMException&&error.name==='AbortError')return;setPlaceResults([]);setPlaceSearched(true);setNotice({kind:'error',text:'Bağlantı sorunu yaşanıyor, lütfen tekrar deneyin.'});}).finally(()=>{if(!controller.signal.aborted)setPlaceLoading(false);});},500);return()=>{window.clearTimeout(timer);controller.abort();};},[placeQuery]);
  useEffect(()=>{let cancelled=false;async function runSearch(){const q=debouncedQuery.trim();if(!q){setSearchResultIds(null);return;}if(!supabase||!canSeePins){setSearchResultIds([]);return;}const {data,error}=await supabase.rpc('pins_search',{q});if(cancelled)return;if(error){setSearchResultIds([]);setNotice({kind:'error',text:'Bağlantı sorunu yaşanıyor, lütfen tekrar deneyin.'});return;}setSearchResultIds((data??[]).map((row:{id:string})=>row.id));}void runSearch();return()=>{cancelled=true;};},[debouncedQuery,canSeePins]);
  useEffect(()=>{let isCancelled=false;if(!selected){setSelectedAddress(null);return()=>{isCancelled=true;};}setSelectedAddress('Adres aranıyor...');const url=`https://nominatim.openstreetmap.org/reverse?format=json&lat=${selected.lat}&lon=${selected.lng}&zoom=18&addressdetails=1&accept-language=tr`;fetch(url,{headers:{'Accept':'application/json','Accept-Language':'tr'}}).then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json() as Promise<{display_name?:string;address?:Record<string,string>}>;}).then(result=>{if(isCancelled)return;const address=result.address??{};const street=address.road||address.pedestrian||address.footway||address.path||address.residential;const neighbourhood=address.neighbourhood||address.suburb||address.quarter||address.residential;const district=address.city_district||address.district||address.borough||address.county;const city=address.city||address.town||address.village||address.municipality;const province=address.state||address.province;const parts:string[]=[];const add=(value:string|undefined)=>{if(value&&!parts.includes(value))parts.push(value);};if(neighbourhood)add(/mahallesi$/i.test(neighbourhood)?neighbourhood:`${neighbourhood} Mah.`);if(street)add(street);add(district);add(city);if(province&&province!==city)add(province);const formatted=parts.length?parts.join(', '):result.display_name?.trim();setSelectedAddress(formatted||null);}).catch(()=>{if(!isCancelled)setSelectedAddress(null);});return()=>{isCancelled=true;};},[selected]);
  useEffect(()=>{if(!selected)return;void ensurePhotoUrls((selected.pin_photos??[]).map(photo=>photo.storage_path));},[selected,ensurePhotoUrls]);
  const selectedPhotos=useMemo(()=>selected?[...(selected.pin_photos??[])].sort((a,b)=>a.sort_order-b.sort_order):[],[selected]);
  useEffect(()=>{if(lightboxIndex===null)return;const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')setLightboxIndex(null);else if(event.key==='ArrowRight')setLightboxIndex(index=>index===null?null:(index+1)%selectedPhotos.length);else if(event.key==='ArrowLeft')setLightboxIndex(index=>index===null?null:(index-1+selectedPhotos.length)%selectedPhotos.length);};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[lightboxIndex,selectedPhotos.length]);

  async function submitAuth(e:FormEvent){e.preventDefault();if(!supabase)return;setBusy(true);setNotice(null);try{if(authMode==='signup'){const {error}=await supabase.auth.signUp({email,password});if(error)throw error;setNotice({kind:'success',text:'Kayıt oluşturuldu. Giriş yapabilirsiniz.'});}else{const {error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;setAuthOpen(false);setNotice({kind:'success',text:'Giriş yapıldı.'});}}catch(err){const message=err instanceof Error?err.message:'';setNotice({kind:'error',text:authMode==='login'&&/invalid login credentials|invalid_credentials/i.test(message)?'E-posta veya şifre hatalı. Lütfen tekrar deneyin veya yeni kayıt olun.':message||'İşlem başarısız.'});}finally{setBusy(false);}}

  async function savePinDirectly(position:[number,number],descriptionValue:string,categoryValue:string,filesValue:File[]){
    if(!supabase){setNotice({kind:'error',text:'Veritabanı bağlantısı hazır değil. Sayfayı yenileyip tekrar deneyin.'});return;}
    if(!session?.user||!canAdd){setNotice({kind:'error',text:'Pin kaydetmek için giriş yapmış ve aktif üye olmalısınız.'});return;}
    if(!position||!Number.isFinite(position[0])||!Number.isFinite(position[1])){setNotice({kind:'error',text:'Lütfen önce konum seçin.'});return;}
    if(busy){setNotice({kind:'info',text:'Önceki kayıt işlemi devam ediyor. Lütfen bekleyin.'});return;}
    if(filesValue.length>3){setNotice({kind:'error',text:'En fazla 3 fotoğraf seçebilirsin.'});return;}
    if(containsProfanity(descriptionValue)){setNotice({kind:'error',text:'Açıklamanızda uygun olmayan bir ifade tespit edildi.'});return;}
    setBusy(true);setNotice({kind:'info',text:'Pin kaydediliyor…'});
    const paths:string[]=[];
    try{
      const photoRows:{storage_path:string;public_url:string;sort_order:number}[]=[];
      for(let i=0;i<filesValue.length;i++){
        const blob=await compressPhoto(filesValue[i]);
        const path=`${session.user.id}/${crypto.randomUUID()}.jpg`;
        const {error}=await supabase.storage.from('pin-photos').upload(path,blob,{contentType:'image/jpeg',upsert:false});
        if(error)throw error;
        paths.push(path);
        const {data}=supabase.storage.from('pin-photos').getPublicUrl(path);
        photoRows.push({storage_path:path,public_url:data.publicUrl,sort_order:i});
      }
      const {error}=await supabase.rpc('create_pin_with_photos',{ p_lat:position[0],p_lng:position[1],p_description:descriptionValue.trim(), p_category:categoryValue,p_photos:photoRows });
      if(error)throw error;
      setDescription('');setCategory('KIRMIZI');setFiles([]);setDraftPosition(null);
      const input=document.getElementById('photo-input') as HTMLInputElement|null;if(input)input.value='';
      setNotice({kind:'success',text:'Konum başarıyla kaydedildi.'});
      await loadPins();
    }catch(err){
      if(paths.length)await supabase.storage.from('pin-photos').remove(paths);
      const errorMessage=err&&typeof err==='object'&&'message'in err?String((err as {message?:unknown}).message??''):err instanceof Error?err.message:'';
      if (/limitine/i.test(errorMessage)) { setNotice({kind:'error', text:'Günlük pin ekleme limitinize (10) ulaştınız. Lütfen yarın tekrar deneyin.'}); } 
      else if (/uygun olmayan ifadeler/i.test(errorMessage)) { setNotice({kind:'error', text:'Açıklamanızda uygun olmayan bir ifade tespit edildi.'}); } 
      else { setNotice({kind:'error', text:errorMessage||'Pin kaydedilemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.'}); }
    }finally{setBusy(false);}
  }

  async function addPin(e:FormEvent){e.preventDefault();if(!draftPosition){setNotice({kind:'error',text:'Lütfen önce konum seçin.'});return;}await savePinDirectly(draftPosition,description,category,files);}
  function beginPinEdit(){
    if(!selected||!canDeleteSelected)return;
    setEditDescription(pinDescription(selected));
    setEditCategory(normalizeCategory(selected.category));
    setEditPhotos([...selectedPhotos]);
    setEditFiles([]);
    setEditError(null);
    setEditPinMode(true);
    setNotice(null);
  }

  async function savePinEdits(e:FormEvent){
    e.preventDefault();
    if(!supabase)return;
    if(!selected||!canDeleteSelected||busy)return;

    const client=supabase;
    const targetPin=selected;
    const userId=session?.user?.id;
    if(!userId){
      const message='Fotoğraf güncellemek için tekrar giriş yapmalısınız.';
      setEditError(message);
      setNotice({kind:'error',text:message});
      return;
    }

    const cleanDescriptionToSave=editDescription.trim();
    const descriptionToSave=isTelegramPin(targetPin.description, targetPin.owner_id)
      ? `${TELEGRAM_PIN_MARKER} ${cleanDescriptionToSave}`.slice(0,5000)
      : cleanDescriptionToSave;
    const categoryToSave=editCategory;
    const keptPhotos=[...editPhotos];
    const originalPhotos=[...selectedPhotos];
    const filesToUpload=[...editFiles];

    if(containsProfanity(descriptionToSave)){
      const message='Açıklamanızda uygun olmayan bir ifade tespit edildi.';
      setEditError(message);
      setNotice({kind:'error',text:message});
      return;
    }
    if(keptPhotos.length+filesToUpload.length>3){
      const message='Toplam fotoğraf sayısı 3 adedi geçemez.';
      setEditError(message);
      setNotice({kind:'error',text:message});
      return;
    }

    setBusy(true);
    setEditError(null);
    setNotice({kind:'info',text:'Değişiklikler kaydediliyor…'});
    const uploadedPaths:string[]=[];
    let pinDetailsSaved=false;

    try{
      const newPhotoRows:{pin_id:string;storage_path:string;public_url:string;sort_order:number}[]=[];
      for(let index=0;index<filesToUpload.length;index++){
        const blob=await compressPhoto(filesToUpload[index]);
        const path=`${userId}/${crypto.randomUUID()}.jpg`;
        const {error:uploadError}=await client.storage.from('pin-photos').upload(path,blob,{contentType:'image/jpeg',upsert:false});
        if(uploadError)throw uploadError;
        uploadedPaths.push(path);
        const {data}=client.storage.from('pin-photos').getPublicUrl(path);
        newPhotoRows.push({pin_id:targetPin.id,storage_path:path,public_url:data.publicUrl,sort_order:keptPhotos.length+index});
      }

      for(let index=0;index<keptPhotos.length;index++){
        const {error:orderError}=await client.from('pin_photos').update({sort_order:index}).eq('id',keptPhotos[index].id);
        if(orderError)throw orderError;
      }

      let insertedPhotos:PinPhoto[]=[];
      if(newPhotoRows.length){
        const {data:insertedData,error:insertError}=await client.from('pin_photos').insert(newPhotoRows).select('id,storage_path,public_url,sort_order');
        if(insertError)throw insertError;
        insertedPhotos=(insertedData??[]) as PinPhoto[];
        if(insertedPhotos.length!==newPhotoRows.length)throw new Error('Yeni fotoğraf kayıtları doğrulanamadı.');
      }

      const {data:updatedData,error:pinError}=await client.from('pins').update({description:descriptionToSave,category:categoryToSave}).eq('id',targetPin.id).select('id');
      if(pinError)throw pinError;
      if(!updatedData||updatedData.length===0)throw new Error('Pin güncellenemedi (yetki hatası olabilir).');

      pinDetailsSaved=true;
      const pinWithUpdatedDetails:Pin={...targetPin,description:descriptionToSave,category:categoryToSave};
      setPins(current=>current.map(pin=>pin.id===targetPin.id?{...pin,description:descriptionToSave,category:categoryToSave}:pin));
      setSelected(current=>current?.id===targetPin.id?{...current,description:descriptionToSave,category:categoryToSave}:current);

      const keptIds=new Set(keptPhotos.map(photo=>photo.id));
      const removedPhotos=originalPhotos.filter(photo=>!keptIds.has(photo.id));
      if(removedPhotos.length){
        const {error:removeRowsError}=await client.from('pin_photos').delete().in('id',removedPhotos.map(photo=>photo.id));
        if(removeRowsError)throw removeRowsError;
      }

      const nextPhotos:PinPhoto[]=[
        ...keptPhotos.map((photo,index)=>({...photo,sort_order:index})),
        ...insertedPhotos.map((photo,index)=>({...photo,sort_order:keptPhotos.length+index})),
      ];
      const updatedPin:Pin={...pinWithUpdatedDetails,pin_photos:nextPhotos};
      setPins(current=>current.map(pin=>pin.id===targetPin.id?updatedPin:pin));
      setSelected(current=>current?.id===targetPin.id?updatedPin:current);

      let cleanupMessage='';
      const removedPaths=removedPhotos.map(photo=>photo.storage_path);
      if(removedPaths.length){
        try{
          const {error:storageError}=await client.storage.from('pin-photos').remove(removedPaths);
          if(storageError)cleanupMessage=storageError.message;
        }catch(cleanupError:unknown){
          cleanupMessage=cleanupError instanceof Error?cleanupError.message:String(cleanupError);
        }
      }

      setEditPinMode(false);
      setEditFiles([]);
      setEditError(null);
      setNotice(cleanupMessage
        ? {kind:'error',text:`Pin güncellendi ancak silinen fotoğraf dosyalarının temizlenmesi başarısız oldu: ${cleanupMessage}`}
        : {kind:'success',text:'Değişiklikler kaydedildi.'});
      await loadPins();
    }catch(error:unknown){
      let cleanupMessage='';
      if(uploadedPaths.length){
        try{
          const {error:rowsCleanupError}=await client.from('pin_photos').delete().in('storage_path',uploadedPaths);
          if(rowsCleanupError)cleanupMessage=rowsCleanupError.message;
        }catch(rowsCleanupError:unknown){
          cleanupMessage=rowsCleanupError instanceof Error?rowsCleanupError.message:String(rowsCleanupError);
        }
        try{
          const {error:storageCleanupError}=await client.storage.from('pin-photos').remove(uploadedPaths);
          if(storageCleanupError)cleanupMessage=[cleanupMessage,storageCleanupError.message].filter(Boolean).join(' ');
        }catch(storageCleanupError:unknown){
          const storageErrorText=storageCleanupError instanceof Error?storageCleanupError.message:String(storageCleanupError);
          cleanupMessage=[cleanupMessage,storageErrorText].filter(Boolean).join(' ');
        }
      }

      const rawMessage=error instanceof Error?error.message:
        error!==null&&typeof error==='object'&&'message' in error?String(error.message??''):'';
      const baseMessage=rawMessage||'Pin değişiklikleri kaydedilemedi. Lütfen tekrar deneyin.';
      const message=pinDetailsSaved
        ? `Pin açıklaması ve kategorisi kaydedildi ancak fotoğraf işlemi tamamlanamadı: ${baseMessage}`
        : baseMessage;
      const fullMessage=cleanupMessage
        ? `${message} Yeni fotoğraf temizliği uyarısı: ${cleanupMessage}`
        : message;
      setEditError(fullMessage);
      setNotice({kind:'error',text:fullMessage});
    }finally{
      setBusy(false);
    }
  }

  async function togglePinVote(voteType:1|-1){
    if(!supabase||!selected||!session?.user||selected.owner_id===session.user.id||busy)return;
    const pinId=selected.id;const previous=selected.pin_votes??[];const existing=previous.find(vote=>vote.user_id===session.user.id);
    const nextVotes=existing?.vote_type===voteType?previous.filter(vote=>vote.user_id!==session.user.id):[...previous.filter(vote=>vote.user_id!==session.user.id),{vote_type:voteType,user_id:session.user.id}];
    setSelected(current=>current?.id===pinId?{...current,pin_votes:nextVotes}:current);setPins(current=>current.map(pin=>pin.id===pinId?{...pin,pin_votes:nextVotes}:pin));
    try{
      const {error}=await supabase.rpc('toggle_pin_vote',{p_pin_id:pinId,p_vote_type:voteType});if(error)throw error;
      const {data,error:refreshError}=await supabase.from('pins').select('id,owner_id,lat,lng,description,category,created_at,pin_photos(id,storage_path,public_url,sort_order),pin_votes(vote_type,user_id)').eq('id',pinId).maybeSingle();
      if(refreshError)throw refreshError;if(data){const updated=data as unknown as Pin;setSelected(current=>current?.id===pinId?updated:current);setPins(current=>current.map(pin=>pin.id===pinId?updated:pin));}
    }catch(err){setSelected(current=>current?.id===pinId?{...current,pin_votes:previous}:current);setPins(current=>current.map(pin=>pin.id===pinId?{...pin,pin_votes:previous}:pin));setNotice({kind:'error',text:err instanceof Error?err.message:'Oy kaydedilemedi.'});}
  }

  async function deletePinById(pinId: string) {
    if(!supabase || busy) return;
    if(!window.confirm("Bu noktayı silmek istediğinize emin misiniz?")) return;
    setBusy(true); setNotice(null);
    try {
      const { data: paths, error } = await supabase.rpc('delete_pin', { p_pin_id: pinId });if (error) throw error;
      let storageCleanupError: string | null = null;
      if (Array.isArray(paths) && paths.length) {const { error: removeError } = await supabase.storage.from('pin-photos').remove(paths as string[]);if (removeError) storageCleanupError = removeError.message;}
      setPins(current => current.filter(pin => pin.id !== pinId));
      if (selected?.id === pinId) {setSelected(null);setLightboxIndex(null);}
      if (storageCleanupError) setNotice({ kind: 'error', text: `Nokta silindi ancak fotoğraf temizliği başarısız: ${storageCleanupError}` });
      else setNotice({ kind: 'success', text: 'Nokta ve fotoğrafları silindi.' });
    } catch (err) {setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Nokta silinemedi.' });} finally {setBusy(false);}
  }

  async function changeSelectedPinCategory(newCategory: string) {
    if (!supabase || !selected || !canDeleteSelected || busy) return;setBusy(true);
    try {
      const { error } = await supabase.from('pins').update({ category: newCategory }).eq('id', selected.id).select();if (error) throw error;
      setSelected(prev => prev ? { ...prev, category: newCategory } : null);setPins(current => current.map(p => p.id === selected.id ? { ...p, category: newCategory } : p));
      setNotice({ kind: 'success', text: `Kategori ${newCategory} olarak değiştirildi.` });
    } catch (err) {setNotice({ kind: 'error', text: 'Kategori değiştirilemedi.' });} finally {setBusy(false);}
  }
  
  async function deleteBulkPins() {
    if(!supabase || bulkSelectedPins.length === 0 || busy) return;
    if(!window.confirm(`${bulkSelectedPins.length} adet noktayı silmek istediğinize emin misiniz?`)) return;
    setBusy(true); setNotice(null);
    try {
      const { data: paths, error } = await supabase.rpc('delete_pins_bulk', { p_pin_ids: bulkSelectedPins });if (error) throw error;
      if (Array.isArray(paths) && paths.length > 0) await supabase.storage.from('pin-photos').remove(paths);
      setPins(current => current.filter(pin => !bulkSelectedPins.includes(pin.id)));
      setSelected(null);setBulkSelectedPins([]);setBulkSelectMode(false);
      setNotice({ kind: 'success', text: `${bulkSelectedPins.length} nokta başarıyla silindi.` });
    } catch (err: any) {setNotice({ kind: 'error', text: err?.message || 'Toplu silme başarısız.' });} finally {setBusy(false);}
  }

  async function reportPin(pinId: string, pinDesc: string, pinCat: string | null) {
    if(!supabase || !session?.user) return;if(!window.confirm("Bu pini uygunsuz içerik nedeniyle rapor etmek istiyor musunuz?")) return;
    try {const { error } = await supabase.from('pin_reports').insert({ pin_id: pinId, reporter_id: session.user.id, pin_description: pinDesc, pin_category: pinCat });if (error) throw error;setNotice({ kind: 'success', text: 'Raporunuz yöneticiye iletildi.' });} 
    catch (err) {setNotice({ kind: 'error', text: 'Rapor gönderilemedi.' });}
  }

  async function signOut(){if(!supabase)return;setProfileMenuOpen(false);setInviteOpen(false);await supabase.auth.signOut();setNotice({kind:'info',text:'Oturum kapatıldı.'});}
  async function loadInviteCodes(){if(!supabase||!session?.user||!active)return;setBusy(true);try{const {data,error}=await supabase.rpc('list_my_reference_codes');if(error)throw error;setInviteCodes((data??[]) as InviteCode[]);}catch(err){setNotice({kind:'error',text:err instanceof Error?err.message:'Davet kodları yüklenemedi.'});}finally{setBusy(false);}}
  async function openInviteCodes(){setProfileMenuOpen(false);setInviteOpen(true);await loadInviteCodes();}
  async function createInviteCode(){if(!supabase||!session?.user||!active)return;setBusy(true);setNotice(null);try{const {data,error}=await supabase.rpc('create_invite_code');if(error)throw error;const result=Array.isArray(data)?data[0]:data;const code=typeof result==='string'?result:result?.code;if(!code)throw new Error('Kod bilgisi alınamadı.');const row:InviteCode={id:typeof result==='object'&&result?.id?result.id:code,code,created_at:new Date().toISOString(),redeemed_at:null,is_enabled:true};setInviteCodes(current=>[row,...current]);setNotice({kind:'success',text:'Kod başarıyla oluşturuldu!'});}catch(err){setNotice({kind:'error',text:err instanceof Error?err.message:'Davet kodu oluşturulamadı.'});}finally{setBusy(false);}}
  async function copyInviteCode(item:InviteCode){if(!item.code){setNotice({kind:'info',text:'Eski kodlar kopyalanamaz.'});return;}try{await navigator.clipboard.writeText(item.code);setCopiedCodeId(item.id);setNotice({kind:'success',text:'Davet kodu kopyalandı.'});window.setTimeout(()=>setCopiedCodeId(current=>current===item.id?null:current),1800);}catch{setNotice({kind:'error',text:'Kopyalanamadı.'});}}

  async function openAdminPanel() {
    setProfileMenuOpen(false);setAdminOpen(true);setAdminLoading(true);if(!supabase) return;
    try {
      const { data: profilesData, error: profilesError } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });if (profilesError) throw profilesError;setAdminProfiles(profilesData || []);
      const { data: reportsData, error: reportsError } = await supabase.from('pin_reports').select('*, pins(description, category)').order('created_at', { ascending: false });if (reportsError) throw reportsError;setAdminReports(reportsData || []);
    } catch (err) {setNotice({ kind: 'error', text: 'Admin verileri yüklenemedi.' });} finally {setAdminLoading(false);}
  }

  async function updateUserStatus(userId: string, newStatus: string) {
    if(!supabase) return;
    try {
      const { error } = await supabase.from('profiles').update({ status: newStatus }).eq('id', userId);if (error) throw error;
      setAdminProfiles(current => current.map(p => p.id === userId ? { ...p, status: newStatus } : p));
      setNotice({ kind: 'success', text: 'Kullanıcı durumu güncellendi.' });await loadPins();
    } catch (err) {setNotice({ kind: 'error', text: 'İşlem başarısız.' });}
  }

  async function resolveReport(reportId: string, action: 'ignore'|'delete') {
    if(!supabase) return;
    try {
      if (action === 'ignore') {await supabase.from('pin_reports').update({ status: 'ignored' }).eq('id', reportId);setAdminReports(curr => curr.filter(r => r.id !== reportId));setNotice({kind:'success', text:'Rapor yoksayıldı.'});} 
      else if (action === 'delete') {const report = adminReports.find(r => r.id === reportId);if (!report) return;if (report.pin_id) await supabase.rpc('delete_pin', { p_pin_id: report.pin_id });await supabase.from('pin_reports').delete().eq('pin_id', report.pin_id);setAdminReports(curr => curr.filter(r => r.pin_id !== report.pin_id));await loadPins();setNotice({kind:'success', text:'Rapor kapatıldı.'});}
    } catch (err) {setNotice({kind:'error', text:'İşlem başarısız.'});}
  }
  
  function startListening(field:string,setValue:SpeechSetter){
    if(!speechSupported)return;if(listeningField===field){recognitionRef.current?.stop();return;}recognitionRef.current?.stop();
    const speechWindow=window as Window & {SpeechRecognition?:new()=>SpeechRecognitionInstance;webkitSpeechRecognition?:new()=>SpeechRecognitionInstance};
    const Recognition=speechWindow.SpeechRecognition||speechWindow.webkitSpeechRecognition;if(!Recognition){setSpeechSupported(false);return;}
    const recognition=new Recognition();let recognizedText='';let recognizedFullText='';recognition.lang='tr-TR';recognition.interimResults=false;recognition.maxAlternatives=1;
    recognition.onstart=()=>setListeningField(field);
    recognition.onresult=(event:any)=>{
      const transcript=String(event.results?.[0]?.[0]?.transcript??'').trim();if(!transcript)return;recognizedText=transcript;
      if (field === 'placeQuery') { setValue(transcript); } 
      else { setValue(current=>{ recognizedFullText=`${current}${current&&!/\s$/.test(current)?' ':''}${transcript}`; return recognizedFullText; }); }
    };
    recognition.onerror=(event:any)=>{if(event.error==='not-allowed'||event.error==='service-not-allowed')setNotice({kind:'error',text:'Mikrofon erişimi reddedildi'});else if(event.error==='audio-capture')setNotice({kind:'error',text:'Mikrofon bulunamadı.'});else if(event.error!=='no-speech'&&event.error!=='aborted')setNotice({kind:'error',text:'Ses tanıma hatası.'});setListeningField(null);};
    recognition.onend=()=>{setListeningField(null);if(recognitionRef.current===recognition)recognitionRef.current=null;if(!recognizedText)return;if(field==='placeQuery'){setPlaceDropdownOpen(true);}else if(field==='query'&&recognizedFullText){setDebouncedQuery(recognizedFullText.trim());}};
    recognitionRef.current=recognition;try{recognition.start();}catch{setListeningField(null);recognitionRef.current=null;setNotice({kind:'error',text:'Ses tanıma başlatılamadı.'});}
  }
  
  const locationErrorText='Konum izni gerekli veya konum alınamadı. Lütfen tarayıcı ayarlarınızdan izin verin.';
  type VoiceCommand =
    | { type: 'LOCATE'; category: string }
    | { type: 'CREATE_PIN'; category: string; useCurrentLocation: boolean }
    | { type: 'SAVE' }
    | { type: 'TRAFFIC'; enabled: boolean }
    | { type: 'HEATMAP'; enabled: boolean }
    | { type: 'FILTER'; category: string }
    | { type: 'ROUTE'; destination: string }
    | { type: 'ZOOM'; action: 'in' | 'out' }
    | { type: 'SEARCH_PLACE'; query: string }
    | { type: 'CLEAR_ROUTE' }
    | { type: 'THEME'; mode: 'dark' | 'light' }
    | { type: 'DELETE_PIN'; target: 'selected' | 'nearest' }
    | { type: 'CLEAR_SEARCH' }
    | { type: 'CHANGE_CATEGORY'; category: string }
    | { type: 'MIC_CONTROL'; target: 'search' | 'command' | 'off' };

  async function getLLMEngine(): Promise<MLCEngine | null> {
    if (llmEngineRef.current) return llmEngineRef.current;
    if (llmEngine) return llmEngine;
    if (typeof navigator === 'undefined' || !(navigator as any).gpu) return null;
    if (llmLoadPromiseRef.current) return llmLoadPromiseRef.current;

    setLlmLoading(true);
    const loadPromise = (async (): Promise<MLCEngine | null> => {
      try {
        // WebLLM and its model resources are downloaded only if regex parsing cannot handle a command.
        const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
        const engine = await CreateMLCEngine(
          "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
          { initProgressCallback: (progress) => console.log("Model indiriliyor:", progress.text) }
        );
        llmEngineRef.current = engine;
        setLlmEngine(engine);
        return engine;
      } catch (error) {
        console.error("LLM yüklenirken hata oluştu:", error);
        return null;
      } finally {
        setLlmLoading(false);
        // Keep the successful engine cached; allow retry only after a failed initialization.
        if (!llmEngineRef.current) llmLoadPromiseRef.current = null;
      }
    })();

    llmLoadPromiseRef.current = loadPromise;
    return loadPromise;
  }

  async function parseVoicePinCommand(transcript:string):Promise<VoiceCommand|null>{
    const normalized=transcript.toLocaleLowerCase('tr-TR').replace(/['’‘]/g,'').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
    if(!normalized)return null;

    if (/komut\s*dinle|mikrofonu\s*aç|mikrofonu\s*aktif\s*et|beni\s*dinle|komut\s*mikrofonu/.test(normalized)) return { type: 'MIC_CONTROL', target: 'command' };
    if (/mikrofonu\s*kapat|dinlemeyi\s*durdur|sus|kapat\s*mikrofonu|mikrofonu\s*kapa/.test(normalized)) return { type: 'MIC_CONTROL', target: 'off' };
    if (/(?:aramayı|arama|filtreleri)\s*(?:temizle|sil|kaldır)|^temizle$|^sil$/.test(normalized)) return { type: 'CLEAR_SEARCH' };
    if (/(?:yakınlaş|yaklaştır|zoom yap|büyüt|yaklaş)/.test(normalized)) return { type: 'ZOOM', action: 'in' };
    if (/(?:uzaklaş|uzaklaştır|küçült)/.test(normalized)) return { type: 'ZOOM', action: 'out' };
    if (/(?:rota temizle|rotayı temizle|rotayı iptal et|rotayı kapat)/.test(normalized)) return { type: 'CLEAR_ROUTE' };
    if (/(?:gece modu|karanlık mod|siyah tema)/.test(normalized)) return { type: 'THEME', mode: 'dark' };
    if (/(?:gündüz modu|aydınlık mod|beyaz tema)/.test(normalized)) return { type: 'THEME', mode: 'light' };
    if (/(?:ısı|isi)(?:\s*haritas[ıi])?\s*(?:aç|göster|aktif)/.test(normalized)) return { type: 'HEATMAP', enabled: true };
    if (/(?:ısı|isi)(?:\s*haritas[ıi])?\s*(?:kapat|gizle)/.test(normalized)) return { type: 'HEATMAP', enabled: false };
    if (/traf(?:ik|iği)\s*(?:aç|göster|aktif)/.test(normalized)) return { type: 'TRAFFIC', enabled: true };
    if (/traf(?:ik|iği)\s*(?:kapat|gizle)/.test(normalized)) return { type: 'TRAFFIC', enabled: false };
    if (/(?:sil|kaldır|yok et|temizle)/.test(normalized)) return { type: 'DELETE_PIN', target: /konum|konumum|burada|yakınımda/.test(normalized) ? 'nearest' : 'selected' };
    if (/(?:tümü|hepsi|tümünü|hepsini|tüm pinler|filtreleri kaldır|filtreyi kaldır)/.test(normalized)) return { type: 'FILTER', category: 'Tümü' };

    const categoryWords=[
      {pattern:/(?:^|\s)(?:mavi|maviler)(?=$|\s)/,value:'MAVİ'},
      {pattern:/(?:^|\s)(?:yeşil|yeşiller)(?=$|\s)/,value:'YEŞİL'},
      {pattern:/(?:^|\s)(?:kırmızı|kırmızılar)(?=$|\s)/,value:'KIRMIZI'},
      {pattern:/(?:^|\s)(?:sarı|sarılar|sari|sarilar|gri|griler)(?=$|\s)/,value:'SARI'}
    ];
    const matchedCategory=categoryWords.find(item=>item.pattern.test(normalized))?.value;
    
    if(matchedCategory && /(?:değiştir|yap|dönüştür)/.test(normalized)) return { type: 'CHANGE_CATEGORY', category: matchedCategory };
    if(matchedCategory&&/(?:^|\s)(?:göster|filtrele|sadece)(?=$|\s)/.test(normalized)) return { type: 'FILTER', category: matchedCategory };

    const routeIntent=/(?:\brota\b|\bgit\b|\bgitmek\b|\byol\s+tarifi\b|\bnasıl\s+giderim\b|\bulaşım\b)/.test(normalized);
    const searchIntent=/(?:\bara\b|\bbul\b|\bgöster\b|\bkonumuna\s+git\b)/.test(normalized);
    const hasSave=/(?:^|\s)kaydet(?=$|\s)/.test(normalized);

    if(routeIntent){
      const destination=normalized.replace(/\b(?:mevcut\s+konumumdan|konumumdan|buradan|lütfen|bana)\b/g,' ').replace(/\b(?:yol\s+tarifi|nasıl\s+giderim|ulaşım|gitmek|git|rota|oluştur|olustur|çiz|ciz|gitmek\s+istiyorum)\b/g,' ').replace(/\s+/g,' ').trim();
      const cleanedDestination=destination.replace(/(?:ne|na|ye|ya|e|a)$/,'').trim();
      if(cleanedDestination) return { type: 'ROUTE', destination: cleanedDestination };
    }

    if (searchIntent) {
      const queryStr = normalized.replace(/\b(?:ara|bul|göster|konumuna\s+git)\b/g, '').replace(/\s+/g, ' ').trim();
      if (queryStr) return { type: 'SEARCH_PLACE', query: queryStr };
    }

    const hasPinKeyword=/\b(?:pin|işaret|işaretleri|işareti|nokta)\b/.test(normalized);
    const useCurrentLocation=/\b(?:konum|konuma|konumuma|konumumda|gps)\b/.test(normalized);

    if(hasSave&&!matchedCategory&&!hasPinKeyword)return { type: 'SAVE' };
    if(matchedCategory&&hasPinKeyword) return hasSave ? { type: 'CREATE_PIN', category: matchedCategory, useCurrentLocation } : { type: 'LOCATE', category: matchedCategory };
    if(hasSave)return { type: 'SAVE' };
    if (normalized.split(' ').length <= 4) return { type: 'SEARCH_PLACE', query: normalized };

    const engine = await getLLMEngine();
    if (engine) {
      try {
        const reply = await engine.chat.completions.create({
          messages: [
            {
              role: "system",
              content: "Sen bir harita asistanısın. Kullanıcının cümlesini şu kategorilerden birine ayır: TRAFFIC_ACIK, TRAFFIC_KAPALI, ROTA, ARAMA, PIN_SIL, ZOOM_IN, ZOOM_OUT, TEMA_GECE, TEMA_GUNDUZ, BILINMIYOR. Yalnızca kategori adını büyük harfle döndür."
            },
            { role: "user", content: transcript }
          ],
          temperature: 0.1,
          max_tokens: 20,
          stop: ["\n"]
        });
        const resultText = reply.choices[0]?.message?.content?.trim() || "";
        if (resultText.includes("TRAFFIC_ACIK")) return { type: 'TRAFFIC', enabled: true };
        if (resultText.includes("TRAFFIC_KAPALI")) return { type: 'TRAFFIC', enabled: false };
        if (resultText.includes("ZOOM_IN")) return { type: 'ZOOM', action: 'in' };
        if (resultText.includes("ZOOM_OUT")) return { type: 'ZOOM', action: 'out' };
        if (resultText.includes("TEMA_GECE")) return { type: 'THEME', mode: 'dark' };
        if (resultText.includes("TEMA_GUNDUZ")) return { type: 'THEME', mode: 'light' };
        if (resultText.includes("PIN_SIL")) return { type: 'DELETE_PIN', target: 'selected' };
        if (resultText.includes("ROTA")) return { type: 'ROUTE', destination: transcript };
        if (resultText.includes("ARAMA")) return { type: 'SEARCH_PLACE', query: transcript };
      } catch (err) {
        console.warn("LLM komut çözümlemesi başarısız oldu:", err);
      }
    }
    return null;
  }

  async function executeVoiceCommand(command:VoiceCommand):Promise<void>{
    switch(command.type){
      case 'MIC_CONTROL':
        if (command.target === 'off') {
          manualStopRef.current = true;
          if (voicePinTimeoutRef.current !== undefined) window.clearTimeout(voicePinTimeoutRef.current);
          voicePinTimeoutRef.current = undefined; voicePinRecognitionRef.current?.stop();
          setNotice({ kind: 'info', text: 'Mikrofon kapatıldı.' });
        } else { setNotice({ kind: 'success', text: 'Komutlarınızı dinliyorum...' }); setTimeout(() => { startVoicePinCommand(); }, 500); }
        return;
      case 'CLEAR_SEARCH': setQuery(''); setDebouncedQuery(''); setSearchResultIds(null); setPlaceQuery(''); setNotice({ kind: 'success', text: 'Arama temizlendi.' }); return;
      case 'DELETE_PIN':
        if (command.target === 'selected') { if (selected) void deletePinById(selected.id); else setNotice({ kind: 'error', text: 'Silinecek bir pin seçili değil.' }); } 
        else {
          if (!navigator.geolocation) { setNotice({kind:'error', text:'GPS desteklenmiyor.'}); return; }
          setNotice({ kind: 'info', text: 'Yakınınızdaki pin aranıyor...' });
          navigator.geolocation.getCurrentPosition(pos => {
            const userCoord: [number, number] = [pos.coords.latitude, pos.coords.longitude]; let nearestPin: Pin | null = null; let minDistance = Infinity;
            pins.forEach(pin => { const d = haversineMeters(userCoord, [pin.lat, pin.lng]); if (d < minDistance && d <= 50) { minDistance = d; nearestPin = pin; } });
            if (nearestPin) void deletePinById((nearestPin as Pin).id); else setNotice({ kind: 'error', text: 'Yakınınızda silinecek bir pin bulunamadı.' });
          }, () => setNotice({ kind: 'error', text: 'Konumunuz alınamadı.' }));
        } return;
      case 'CHANGE_CATEGORY': void changeSelectedPinCategory(command.category); return;
      case 'ZOOM':
        if (mapRef.current) { command.action === 'in' ? mapRef.current.zoomIn() : mapRef.current.zoomOut(); setNotice({ kind: 'success', text: command.action === 'in' ? 'Yakınlaştırıldı.' : 'Uzaklaştırıldı.' }); } return;
      case 'CLEAR_ROUTE': setRouteMode(false); setRouteStart(null); setRouteEnd(null); setRouteLine(null); setRouteInfo(null); setRouteError(null); setNotice({ kind: 'success', text: 'Rota temizlendi.' }); return;
      case 'THEME': setIsDarkMode(command.mode === 'dark'); setNotice({ kind: 'success', text: command.mode === 'dark' ? 'Gece moduna geçildi.' : 'Gündüz moduna geçildi.' }); return;
      case 'SEARCH_PLACE':
        setNotice({ kind: 'info', text: `"${command.query}" aranıyor...` });
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(command.query)}&countrycodes=tr&limit=1`);
          const data = await res.json();
          if (data && data.length > 0) { const place = data[0]; setPlaceQuery(''); setSearchPlace(place); if (mapRef.current) mapRef.current.flyTo([parseFloat(place.lat), parseFloat(place.lon)], 16); setNotice({ kind: 'success', text: `"${command.query}" bulundu.` }); } 
          else setNotice({ kind: 'error', text: `"${command.query}" bulunamadı.` });
        } catch { setNotice({ kind: 'error', text: 'Arama sırasında hata oluştu.' }); } return;
      case 'LOCATE': addVoicePinAtCurrentLocation(command.category,false); return;
      case 'CREATE_PIN':
        if(command.useCurrentLocation) addVoicePinAtCurrentLocation(command.category,true);
        else if(draftPosition) void savePinDirectly(draftPosition,description,command.category,files);
        else setNotice({kind:'error',text:'Lütfen önce haritadan konum seçin.'}); return;
      case 'SAVE':
        if(!draftPosition){ setNotice({kind:'error',text:'Lütfen önce konum seçin.'}); return; }
        void savePinDirectly(draftPosition,description,category,files); return;
      case 'TRAFFIC': setShowTraffic(command.enabled); if(command.enabled)setShowHeatmap(false); setNotice({kind:'success',text:command.enabled?'Trafik açıldı.':'Trafik kapatıldı.'}); return;
      case 'HEATMAP': setShowHeatmap(command.enabled); if(command.enabled)setShowTraffic(false); setNotice({kind:'success',text:command.enabled?'Isı haritası açıldı.':'Isı haritası kapatıldı.'}); return;
      case 'FILTER': setCategory(command.category); setSelectedCategoryFilter(command.category); setShowFilterOptions(false); setNotice({kind:'success',text:`${command.category} işaretleri gösteriliyor.`}); return;
      case 'ROUTE':
        setNotice({kind:'info',text:`"${command.destination}" aranıyor ve rota hazırlanıyor...`});
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(command.destination)}&countrycodes=tr&limit=1`);
          const searchData = await res.json();
          if (searchData && searchData.length > 0) {
            const targetCoord: [number, number] = [parseFloat(searchData[0].lat), parseFloat(searchData[0].lon)];
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition(pos => { setRouteStart([pos.coords.latitude, pos.coords.longitude]); setRouteEnd(targetCoord); setRouteMode(true); setNotice({kind:'success', text:`"${command.destination}" için rota oluşturuluyor.`}); }, () => setNotice({kind:'error', text:'Konumunuz alınamadı.'}));
            }
          } else setNotice({kind:'error', text:`"${command.destination}" bulunamadı.`});
        } catch { setNotice({kind:'error', text:'Rota oluşturulurken hata oluştu.'}); } return;
    }
  }

  function addVoicePinAtCurrentLocation(parsedCategory:string,saveImmediately=false){
    if(!navigator.geolocation){setNotice({kind:'error',text:'Bu tarayıcı konum hizmetini desteklemiyor.'});return;}
    setLocating(true);setNotice({kind:'info',text:saveImmediately?'GPS konumu alınıyor; kaydedilecek…':'GPS konumu alınıyor…'});
    navigator.geolocation.getCurrentPosition(async position=>{
      const coords:[number,number]=[position.coords.latitude,position.coords.longitude];
      setUserPosition(coords);setRouteMode(false);setRouteStart(null);setRouteEnd(null);setRouteLine(null);setRouteInfo(null);setRouteError(null);setRouteLoading(false);setSearchPlace(null);setCategory(parsedCategory);
      const descriptionValue=description.trim()||'Sesli komut ile eklendi';setDescription(descriptionValue);
      if(saveImmediately) await savePinDirectly(coords,descriptionValue,parsedCategory,files);
      else { openAddPinAt({lat:coords[0],lng:coords[1]}); setNotice({kind:'success',text:'Konum alındı. Pin hazır; kaydetmek için “Kaydet” deyin.'}); }
      setLocating(false);
    },()=>{setLocating(false);setNotice({kind:'error',text:'GPS konumu alınamadı.'});},{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
  }

  async function startVoicePinCommand(){
    setVoicePinHintVisible(false);
    if(voicePinListening){manualStopRef.current = true; voicePinRecognitionRef.current?.stop(); return;}
    if(!canAdd){setNotice({kind:'info',text:'Sesli pin eklemek için hesabını etkinleştirmen veya giriş yapman gerekiyor.'});setAuthOpen(true);return;}
    const speechWindow=window as Window & {SpeechRecognition?:new()=>SpeechRecognitionInstance;webkitSpeechRecognition?:new()=>SpeechRecognitionInstance};
    const Recognition=speechWindow.SpeechRecognition||speechWindow.webkitSpeechRecognition;
    if(!Recognition){setSpeechSupported(false);setNotice({kind:'error',text:'Bu tarayıcı sesli komutları desteklemiyor.'});return;}
    manualStopRef.current = false;voicePinRecognitionRef.current?.stop();
    if(voicePinTimeoutRef.current!==undefined)window.clearTimeout(voicePinTimeoutRef.current);
    const recognition=new Recognition();
    recognition.lang='tr-TR';recognition.interimResults=false;recognition.maxAlternatives=1;
    recognition.onstart=()=>{setVoicePinListening(true);voicePinTimeoutRef.current=window.setTimeout(()=>{try{manualStopRef.current = true; recognition.stop();}catch{}},60000);};
    recognition.onresult=async (event:any)=>{
      const transcript=String(event.results?.[0]?.[0]?.transcript??'').trim();
      if(!transcript){setNotice({kind:'error',text:'Sesli komut algılanamadı.'});return;}
      const command = await parseVoicePinCommand(transcript);
      if(!command){setNotice({kind:'error',text:`Komut anlaşılmadı: "${transcript}".`});return;}
      try { await executeVoiceCommand(command); } catch { setNotice({kind:'error',text:'Sesli komut çalıştırılırken hata oluştu.'}); }
    };
    recognition.onerror=(event:any)=>{manualStopRef.current = true;if(event.error==='not-allowed'||event.error==='service-not-allowed')setNotice({kind:'error',text:'Mikrofon erişimi reddedildi.'});else if(event.error==='audio-capture')setNotice({kind:'error',text:'Mikrofon bulunamadı.'});else if(event.error==='no-speech')setNotice({kind:'error',text:'Ses algılanmadı.'});else if(event.error!=='aborted')setNotice({kind:'error',text:'Ses tanıma hatası.'});};
    recognition.onend=()=>{
      if (manualStopRef.current) { setVoicePinListening(false); if(voicePinTimeoutRef.current!==undefined){window.clearTimeout(voicePinTimeoutRef.current);voicePinTimeoutRef.current=undefined;} if(voicePinRecognitionRef.current===recognition)voicePinRecognitionRef.current=null; } 
      else { setTimeout(() => { if (!manualStopRef.current && voicePinRecognitionRef.current === recognition) { try { recognition.start(); } catch(e) {} } }, 500); }
    };
    voicePinRecognitionRef.current=recognition;
    try{recognition.start();}catch{setVoicePinListening(false);voicePinRecognitionRef.current=null;setNotice({kind:'error',text:'Ses tanıma başlatılamadı.'});}
  }
    useEffect(()=>()=>{voicePinRecognitionRef.current?.stop();if(voicePinTimeoutRef.current!==undefined)window.clearTimeout(voicePinTimeoutRef.current);},[]);
  function locateUser(useForDraft=false){
    if(locating)return;
    if(!navigator.geolocation){setNotice({kind:'error',text:locationErrorText});return;}
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      position=>{
        const coords:[number,number]=[position.coords.latitude,position.coords.longitude];
        setUserPosition(coords);
        setFlyToUserCoords(coords); // YENİ: 3D haritanın uçması için tetikleyici
        
        if(!is3D && mapRef.current) {
          mapRef.current.flyTo(coords, 16);
        }
        
        if(useForDraft){
          setDraftPosition(coords);
          setSelected(null);
        }else{
          setSelected(null);
          if(draftPosition)setDraftPosition(coords);
        }
        setNotice(null);
        setLocating(false);
      },
      ()=>{
        setNotice({kind:'error',text:locationErrorText});
        setLocating(false);
      },
      {enableHighAccuracy:true,timeout:12000,maximumAge:30000}
    );
  }
  function openAddPinAt(initialCoords:{lat:number;lng:number}){setDraftPosition([initialCoords.lat,initialCoords.lng]);setSelected(null);setLightboxIndex(null);}
  
  const center:[number,number]=[41.0082,28.9784];

  return <main className={`app-shell ${isDarkMode ? '' : 'light-theme'}`}>
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark"><MapPin size={21}/></span><span><strong>AYTAR</strong><small>Daima İleri</small></span></a><div className="top-actions">
      <button type="button" className="icon-button" onClick={() => setIsDarkMode(!isDarkMode)} title={isDarkMode ? 'Gündüz Moduna Geç' : 'Gece Moduna Geç'} style={{ marginRight: '10px' }}>
        {isDarkMode ? <Sun size={20}/> : <Moon size={20}/>}
      </button>
      {llmLoading && <span style={{fontSize: '12px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '5px', marginRight: '10px'}}><BrainCircuit size={14} className="gps-spinner"/> YZ Yükleniyor...</span>}
      {session?<div className="profile-menu-wrap"><button type="button" className={`status-chip profile-trigger ${active?'active':''}`} onClick={()=>setProfileMenuOpen(open=>!open)} aria-expanded={profileMenuOpen} aria-label="Profil menüsünü aç">{profile?.username || (active?'Aktif üye':'Hesap devre dışı')}<ChevronDown size={14}/></button>{profileMenuOpen&&<div className="profile-dropdown"><p className="profile-welcome">Hoş geldin, <strong>{profile?.username || session.user?.email?.split('@')[0] || 'üye'}</strong></p>{profile?.role === 'admin' && <button type="button" className="profile-menu-item" onClick={() => void openAdminPanel()}><ShieldCheck size={16}/> Admin Paneli</button>}{active&&<button type="button" className="profile-menu-item" onClick={()=>void openInviteCodes()}><UserRound size={16}/> Davet Kodlarım</button>}<button type="button" className="profile-menu-item logout-item" onClick={()=>void signOut()}><LogOut size={16}/> Çıkış Yap</button></div>}</div>:<button className="primary-button" onClick={()=>setAuthOpen(true)}><LogIn size={17}/> Giriş / Kayıt</button>}</div></header>
    
    {!isConfigured&&<div className="setup-banner"><strong>Kurulum gerekiyor:</strong> .env dosyasına Supabase URL ve anahtarını ekle; README.md içindeki SQL kurulumunu tamamla.</div>}
    {notice&&<div className={`notice ${notice.kind}`} role="status"><span>{notice.text}</span><button onClick={()=>setNotice(null)} aria-label="Bildirimi kapat"><X size={16}/></button></div>}
    
    <section className="workspace">
      <div className="map-frame">
        
        <div className="place-search-wrap">
          <div className="searchbox place-searchbox">
            <Search size={17}/>
            <input className={speechSupported?'voice-enabled-input':''} value={placeQuery} onFocus={()=>{if(placeQuery.trim())setPlaceDropdownOpen(true);}} onChange={e=>{setPlaceQuery(e.target.value);setPlaceDropdownOpen(true);}} placeholder={listeningField==='placeQuery'?'Dinleniyor...':'Mekan veya adres ara... (Örn: Galata Kulesi)'} aria-label="Mekan veya adres ara"/>
            {placeLoading&&<LoaderCircle className="gps-spinner place-search-spinner" size={17}/>}
            {placeQuery&&<button className="search-clear" type="button" onClick={()=>{setPlaceQuery('');setPlaceResults([]);setPlaceSearched(false);setPlaceDropdownOpen(false);}} aria-label="Mekan aramasını temizle"><X size={15}/></button>}
          </div>
          {placeDropdownOpen&&placeQuery.trim()&&<div className="place-search-results" role="listbox">
            {placeLoading?<div className="place-search-status">Yerler aranıyor...</div>:placeResults.length>0?placeResults.map(result=><button type="button" className="place-search-result" role="option" key={result.place_id} onClick={()=>{setSearchPlace(result);setPlaceQuery('');setPlaceResults([]);setPlaceSearched(false);setPlaceDropdownOpen(false);setSelected(null);setDraftPosition(null);if(!is3D && mapRef.current)mapRef.current.flyTo([Number(result.lat),Number(result.lon)],16);}}><MapPin size={16}/><span>{result.display_name.split(',').slice(0,3).join(',')}</span></button>):placeSearched?<div className="place-search-status">Sonuç bulunamadı</div>:null}
          </div>}
        </div>

        {!is3D && (
          <MapContainer center={center} zoom={11} minZoom={9} maxZoom={19} scrollWheelZoom className="map" ref={mapRef}>
            <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {showHeatmap && <HeatmapLayer pins={visiblePins} />}
            {showTraffic&&tomtomApiKey&&<TileLayer attribution='&copy; TomTom' url={`https://api.tomtom.com/traffic/map/4/tile/flow/relative-delay/{z}/{x}/{y}.png?key=${import.meta.env.VITE_TOMTOM_API_KEY}&t=live&v=${new Date().getTime()}`} zIndex={400} />}
            <MapClick enabled={canAdd&&!editPinMode} routeMode={routeMode} onRoutePick={(lat,lng)=>{if(!routeStart){setRouteStart([lat,lng]);setRouteEnd(null);setRouteLine(null);setRouteInfo(null);setRouteError(null);}else{setRouteEnd([lat,lng]);}}} onMapClick={()=>{setPlaceDropdownOpen(false);setSearchPlace(null);}} onPick={(lat,lng)=>{setDraftPosition([lat,lng]);setSelected(null);}}/>
            <ViewportWatcher onBoundsChange={setViewportBounds}/>
            <FlyTo position={selected?[selected.lat,selected.lng]:draftPosition}/>
            <FlyTo position={userPosition} zoom={16}/>
            <ClusteredPins pins={canSeePins?visiblePins:[]} selectedId={selected?.id??null} isDimmed={pin=>!!debouncedQuery.trim()&&!matchingIds.has(pin.id)} onSelect={pin=>{ if(editPinMode)return; if(bulkSelectMode)setBulkSelectedPins(prev=>prev.includes(pin.id)?prev.filter(id=>id!==pin.id):[...prev,pin.id]); else {setSelected(pin);setSearchPlace(null);setDraftPosition(null);setLightboxIndex(null);} }} />
            {draftPosition&&<Marker position={draftPosition} icon={draftPinIcon} />}
            {!selected&&searchPlace&&<Marker position={[Number(searchPlace.lat),Number(searchPlace.lon)]} icon={searchPlaceIcon} keyboard><Popup><div className="user-location-popup"><strong>{searchPlace.display_name.split(',').slice(0,3).join(',')}</strong><button type="button" onClick={()=>{openAddPinAt({lat:Number(searchPlace.lat),lng:Number(searchPlace.lon)});setSearchPlace(null);}}>Buraya Nokta Ekle</button></div></Popup></Marker>}
            {userPosition&&<Marker position={userPosition} icon={userLocationIcon} keyboard><Popup><div className="user-location-popup"><strong>Şu anki konumun</strong><span>{userPosition[0].toFixed(5)}, {userPosition[1].toFixed(5)}</span><button type="button" onClick={()=>{if(canAdd)openAddPinAt({lat:userPosition[0],lng:userPosition[1]});else setAuthOpen(true);}}>Buraya işaret koy</button></div></Popup></Marker>}
            {routeLine&&<Polyline positions={routeLine} pathOptions={{color:'#2684ff',weight:5,opacity:0.9}}/>}
            {routeStart&&<Marker position={routeStart} icon={routeStartIcon} keyboard title="Rota başlangıcı"/>}
            {routeEnd&&<Marker position={routeEnd} icon={routeEndIcon} keyboard title="Rota bitişi"/>}
          </MapContainer>
        )}

        {is3D && (
          <Map3D 
            pins={filteredPins} 
            onMapClick={(lat: number, lng: number) => {
              if(editPinMode)return;
              setPlaceDropdownOpen(false);
              setSearchPlace(null);
              if (routeMode) {
                if (!routeStart) {
                  setRouteStart([lat, lng]);
                  setRouteEnd(null);
                  setRouteLine(null);
                  setRouteInfo(null);
                  setRouteError(null);
                } else {
                  setRouteEnd([lat, lng]);
                }
              } else {
                setDraftPosition([lat, lng]);
                setSelected(null);
              }
            }}
            onPinSelect={(pin: any) => { if(editPinMode)return; setSelected(pin); setSearchPlace(null); setDraftPosition(null); }}
            userPosition={userPosition}
            flyToCoords={flyToCoords}
            flyToUserCoords={flyToUserCoords}
            draftPosition={draftPosition}
            routeLine={routeLine} routeStart={routeStart} routeEnd={routeEnd}
            showTraffic={showTraffic} showHeatmap={showHeatmap} tomtomApiKey={tomtomApiKey}
          />
        )}

        <div className="map-top-right-controls">
        <div className="map-view-switch" style={{
          position: 'relative', top: 'auto', right: 'auto', zIndex: 1000, 
          display: 'flex', alignItems: 'center', gap: '2px',
          background: 'var(--surface)', border: '1px solid var(--border-color)',
          padding: '4px', borderRadius: '999px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
        }}>
          <button 
            onClick={() => setIs3D(false)}
            style={{
              padding: '6px 14px', borderRadius: '999px', border: 'none',
              background: !is3D ? '#3b82f6' : 'transparent',
              color: !is3D ? '#fff' : 'var(--text-muted)',
              fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s ease',
              fontSize: '12px'
            }}
          >
            2D
          </button>
          <button 
            onClick={() => setIs3D(true)}
            style={{
              padding: '6px 14px', borderRadius: '999px', border: 'none',
              background: is3D ? '#ef4444' : 'transparent',
              color: is3D ? '#fff' : 'var(--text-muted)',
              fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s ease',
              fontSize: '12px'
            }}
          >
            3D
          </button>
        </div>
        <div className="map-top-right-actions">
          <div className="voice-pin-control">{voicePinHintVisible&&!voicePinListening&&<span className="voice-tooltip" role="tooltip">Örn: "Konuma mavi işaret koy", "Trafiği aç" (Kapatmak için 'Sus' deyin)</span>}<button type="button" className={`voice-pin-button ${voicePinListening?'is-listening':''}`} onClick={startVoicePinCommand} aria-label="Sesli komut" aria-pressed={voicePinListening} title={voicePinListening?'Dinliyorum...':'Sesli komut'}> {voicePinListening?<><Mic size={19}/><span>Dinliyorum...</span></>:<Mic size={21}/>}</button></div>
          <button type="button" className="locate-button" onClick={() => locateUser()} disabled={locating} aria-label="Konumumu bul" title="Konumumu bul">{locating?<LoaderCircle className="gps-spinner" size={21}/>:<LocateFixed size={21}/>}</button>
          <button type="button" className={`route-button ${routeMode?'is-active':''}`} onClick={()=>{if(routeMode){setRouteMode(false);setRouteStart(null);setRouteEnd(null);setRouteLine(null);setRouteInfo(null);setRouteError(null);setRouteLoading(false);}else{setRouteMode(true);setRouteStart(null);setRouteEnd(null);setRouteLine(null);setRouteInfo(null);setRouteError(null);setSelected(null);setDraftPosition(null);}}} aria-pressed={routeMode} aria-label={routeMode?'Rota modunu kapat':'Rota oluştur'} title={routeMode?'Rota modunu kapat':'Rota oluştur'}><Navigation size={17}/></button>
          <button type="button" className={`traffic-button ${showTraffic?'is-active':''}`} onClick={()=>{const nextTraffic=!showTraffic;setShowTraffic(nextTraffic);if(nextTraffic&&!tomtomApiKey)setNotice({kind:'error',text:'Trafik katmanı için VITE_TOMTOM_API_KEY yapılandırılmalı.'});}} aria-pressed={showTraffic} aria-label={showTraffic?'Trafik katmanını kapat':'Trafik katmanını aç'} title={showTraffic?'Trafiği kapat':tomtomApiKey?'Trafik':'Trafik (API anahtarı gerekli)'}>🚦</button>
        </div>
        </div>

        {!canSeePins&&!is3D&&<div className="map-overlay"><div className="overlay-icon"><ShieldCheck size={23}/></div><strong>İşaretçiler üyelere özel</strong><p>Harita herkese açık. Konumları görmek ve eklemek için referans koduyla hesabını etkinleştir.</p><button className="primary-button" onClick={()=>setAuthOpen(true)}>Üye ol / giriş yap</button></div>}
      </div>
      
      <aside className="side-panel">
        {bulkSelectMode && (
          <div style={{ padding: '15px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderBottom: '1px solid #ef4444', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#ef4444', fontWeight: 'bold' }}>{bulkSelectedPins.length} Pin Seçildi</span>
            <button onClick={() => void deleteBulkPins()} className="delete-pin-button" disabled={bulkSelectedPins.length === 0 || busy} style={{ marginTop: 0, padding: '8px 16px' }}><X size={16}/> Seçilenleri Sil</button>
          </div>
        )}
        {selected&&!routeMode?<div className="panel-content">
          {editPinMode?<form className="pin-edit-form" onSubmit={savePinEdits}>
            <div className="panel-heading"><div><p className="eyebrow">KONUMU DÜZENLE</p><h2>{pinTitle(selected)}</h2><small className="edit-form-subtitle">Değişikliklerin yalnızca bu konuma uygulanır.</small></div><button type="button" className="icon-button" disabled={busy} onClick={()=>{setEditPinMode(false);setEditFiles([]);setEditError(null);}} aria-label="Düzenlemeyi kapat"><X size={18}/></button></div>
            <div className="edit-field-group"><label className="field-label" htmlFor="edit-category">Kategori</label><select id="edit-category" className="category-select" value={editCategory} onChange={e=>{setEditCategory(e.target.value);setEditError(null);}}><option value="YEŞİL">YEŞİL</option><option value="MAVİ">MAVİ</option><option value="KIRMIZI">KIRMIZI</option><option value="SARI">SARI</option></select></div>
            <div className="edit-field-group"><label className="field-label" htmlFor="edit-description">Açıklama</label><textarea id="edit-description" value={editDescription} onChange={e=>{setEditDescription(e.target.value);setEditError(null);}} maxLength={5000} rows={4} placeholder="Konum açıklaması"/><div className="edit-description-meta"><small>En fazla 5.000 karakter</small><small>{editDescription.length.toLocaleString('tr-TR')}/5.000</small></div>{containsProfanity(editDescription)&&<p className="form-error" role="alert">Açıklamanızda uygun olmayan bir ifade tespit edildi.</p>}</div>
            <div className="edit-photos-heading"><span className="field-label">Mevcut fotoğraflar</span><small>{editPhotos.length+editFiles.length}/3</small></div>
            {editPhotos.length>0?<div className="edit-photo-list">{editPhotos.map(photo=><div className="edit-photo-item" key={photo.id}><img src={photoUrls[photo.storage_path]||photo.public_url} alt="Mevcut pin fotoğrafı"/><span>{photo.storage_path.split('/').pop()}</span><button type="button" className="edit-photo-remove" onClick={()=>{setEditPhotos(current=>current.filter(item=>item.id!==photo.id));setEditError(null);}} aria-label="Fotoğrafı sil" title="Fotoğrafı sil"><X size={15}/></button></div>)}</div>:<p className="comments-empty">Mevcut fotoğraf yok.</p>}
            <div className="edit-field-group"><label className="field-label" htmlFor="edit-photo-input">Yeni fotoğraf ekle <span>Kalan hak: {Math.max(0,3-editPhotos.length-editFiles.length)}</span></label><label className="upload-box edit-upload-box" htmlFor="edit-photo-input"><Camera size={22}/><strong>Fotoğraf seç</strong><small>Toplam en fazla 3 fotoğraf</small><input id="edit-photo-input" type="file" accept="image/*" multiple disabled={editPhotos.length+editFiles.length>=3||busy} onChange={e=>{const chosen=Array.from(e.target.files??[]);const totalAllowed=Math.max(0,3-editPhotos.length);const allowed=Math.max(0,totalAllowed-editFiles.length);setEditFiles(current=>[...current,...chosen.slice(0,Math.max(0,totalAllowed-current.length))].slice(0,totalAllowed));setEditError(chosen.length>allowed?'Toplam fotoğraf sayısı 3 adedi geçemez.':null);if(chosen.length>allowed)setNotice({kind:'error',text:'Toplam fotoğraf sayısı 3 adedi geçemez.'});e.currentTarget.value='';}}/></label></div>
            {editFiles.length>0&&<div className="file-list">{editFiles.map((file,index)=><div key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" aria-label="Yeni fotoğrafı kaldır" onClick={()=>{setEditFiles(current=>current.filter((_,i)=>i!==index));setEditError(null);}}><X size={14}/></button></div>)}</div>}
            {editError&&<p className="form-error edit-form-error" role="alert">{editError}</p>}<div className="edit-form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={()=>{setEditPinMode(false);setEditFiles([]);setEditError(null);}}>İptal</button><button type="submit" className="primary-button" disabled={busy||editPhotos.length+editFiles.length>3||containsProfanity(editDescription)}>{busy?<><LoaderCircle size={15} className="gps-spinner"/> Kaydediliyor…</>:'Değişiklikleri Kaydet'}</button></div>
          </form>:<>
            <div className="panel-heading"><div><p className="eyebrow">KONUM DETAYI</p><span className={`category-badge ${categoryClass(selected.category)}`}>{normalizeCategory(selected.category)}</span>{isTelegramPin(selected.description, selected.owner_id)&&<span className="radar-source-badge"><Radar size={13}/> AYTAR RADAR</span>}<h2>{pinTitle(selected)}</h2></div><button className="icon-button" onClick={()=>{setSelected(null);setLightboxIndex(null);setEditPinMode(false);}} aria-label="Konum detayını kapat"><X size={18}/></button></div><p className="pin-date">{relativeTime(selected.created_at)}</p><p className="pin-description">{pinDescription(selected)||'Açıklama eklenmemiş.'}</p>
            {(()=>{const votes=selected.pin_votes??[];const score=votes.reduce((sum,vote)=>sum+Number(vote.vote_type||0),0);const myVote=session?.user?.id?votes.find(vote=>vote.user_id===session.user.id)?.vote_type??0:0;const ownPin=!!session?.user?.id&&selected.owner_id===session.user.id;return <div className="pin-vote-bar" aria-label={`Toplam oy skoru: ${score}`}><button type="button" className={`pin-vote-button vote-up ${myVote===1?'is-active':''}`} aria-label="Artı oy ver" aria-pressed={myVote===1} disabled={!session?.user||ownPin||busy} onClick={()=>void togglePinVote(1)}>+</button><strong className={`pin-vote-score ${score>0?'score-positive':score<0?'score-negative':''}`}>{score>0?`+${score}`:score}</strong><button type="button" className={`pin-vote-button vote-down ${myVote===-1?'is-active':''}`} aria-label="Eksi oy ver" aria-pressed={myVote===-1} disabled={!session?.user||ownPin||busy} onClick={()=>void togglePinVote(-1)}>−</button>{ownPin&&<small>Kendi noktanı oylayamazsın</small>}{!session?.user&&<small>Oy vermek için giriş yap</small>}</div>;})()}
            <div className={`photo-grid ${selectedPhotos.length===1?'single-photo':''}`}>{selectedPhotos.map((photo,index)=><button key={photo.id} type="button" className="photo-tile" onClick={()=>setLightboxIndex(index)} aria-label={`Fotoğraf ${index+1} / ${selectedPhotos.length} büyüt`}><img src={photoUrls[photo.storage_path]||''} alt={`Konum fotoğrafı ${index+1}`} loading="lazy"/></button>)}</div>
            <div className="selected-address"><MapPin size={17} aria-hidden="true"/><span>{selectedAddress||`${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}`}</span></div>
            <p className="coordinates selected-coordinates">{selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px' }}>
              <a className="directions-link" href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`} target="_blank" rel="noopener noreferrer" style={{ textAlign: 'center', width: '100%', display: 'block' }}>Yol tarifi</a>
              {session?.user && (
                <button type="button" className="primary-button" style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '10px' }} onClick={() => { if(navigator.geolocation) { navigator.geolocation.getCurrentPosition(pos => { setRouteStart([pos.coords.latitude, pos.coords.longitude]); setRouteEnd([selected.lat, selected.lng]); setRouteMode(true); setSelected(null); }, () => setNotice({kind:'error', text:'Rota oluşturmak için konum izni gerekli.'})); } }}><Navigation size={16} style={{ marginRight: '8px' }}/> Buraya Rota Oluştur</button>
              )}
              {canDeleteSelected && (
                <div className="pin-owner-actions">
                  <button type="button" className="secondary-button" disabled={busy} onClick={beginPinEdit}>Düzenle</button>
                  <button type="button" className="delete-pin-button" disabled={busy} onClick={()=>void deletePinById(selected.id)}><X size={16}/>{busy?"Siliniyor…":"Bu Noktayı Sil"}</button>
                </div>
              )}
              {session?.user && !canDeleteSelected && (
                <button type="button" className="secondary-button" style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.5)', padding: '10px' }} onClick={() => void reportPin(selected.id, pinDescription(selected), selected.category)}><ShieldAlert size={16} style={{ marginRight: '8px' }}/> Bu Noktayı Rapor Et</button>
              )}
            </div>
          </>}
        </div>
        :draftPosition&&canAdd&&!routeMode?<form className="panel-content" onSubmit={addPin}><div className="panel-heading"><div><p className="eyebrow">YENİ PAYLAŞIM</p><h2>Konum ekle</h2></div><button type="button" className="icon-button" onClick={()=>setDraftPosition(null)} aria-label="Konum ekleme formunu kapat"><X size={18}/></button></div><div className="draft-coordinates-row"><p className="coordinates">{draftPosition[0].toFixed(5)}, {draftPosition[1].toFixed(5)}</p><button type="button" className="use-location-button" onClick={()=>locateUser(true)} disabled={locating} title="GPS konumunu kullan">{locating?<LoaderCircle className="gps-spinner" size={15}/>:<LocateFixed size={15}/>}<span>{locating?'Konum alınıyor…':'Konumumu Kullan'}</span></button></div><p className="draft-location-hint">📍 Konumu değiştirmek için haritada başka bir noktaya tıklayabilir veya yandaki GPS butonunu kullanabilirsiniz.</p><label className="field-label" htmlFor="category">Kategori</label><select id="category" className="category-select" value={category} onChange={e=>setCategory(e.target.value)}><option value="YEŞİL">YEŞİL</option><option value="MAVİ">MAVİ</option><option value="KIRMIZI">KIRMIZI</option><option value="SARI">SARI</option></select><label className="field-label" htmlFor="description">Açıklama</label><div className={`voice-textarea-wrap ${speechSupported?'voice-supported':''}`}><textarea id="description" className={speechSupported?'voice-enabled-input':''} value={description} onChange={e=>setDescription(e.target.value)} maxLength={5000} placeholder={listeningField==='description'?'Dinleniyor...':'Bu konum hakkında ne paylaşmak istersin?'} rows={3}/>{hasProfanity&&<p role="alert" style={{color:"#dc2626",fontSize:"13px",margin:"6px 0 0"}}>⚠️ Açıklamanızda uygun olmayan bir ifade tespit edildi.</p>}{speechSupported&&<button type="button" className={`voice-button textarea-voice-button ${listeningField==='description'?'is-listening':''}`} onClick={()=>startListening('description',setDescription)} aria-label={listeningField==='description'?'Dinlemeyi durdur':'Açıklamaya sesli giriş'} title={listeningField==='description'?'Dinleniyor...':'Sesli giriş'}><Mic size={16}/></button>}</div><label className="field-label" htmlFor="photo-input">Fotoğraflar <span>İsteğe bağlı · En fazla 3 adet</span></label><label className="upload-box" htmlFor="photo-input"><Camera size={22}/><strong>Fotoğraf seç</strong><small>Görsel dosyası · dosya başına en fazla 12 MB</small><input id="photo-input" type="file" accept="image/*" capture="environment" multiple onChange={e=>{const selectedFiles=Array.from(e.target.files??[]);setFiles(selectedFiles);setNotice(selectedFiles.length>3?{kind:'error',text:'En fazla 3 fotoğraf seçebilirsin.'}:null);}}/></label>{files.length>0&&<div className="file-list">{files.map((file,i)=><div key={`${file.name}-${i}`}><span>{file.name}</span><button type="button" onClick={()=>setFiles(old=>old.filter((_,j)=>j!==i))} aria-label="Dosyayı kaldır"><X size={14}/></button></div>)}</div>}<button className="primary-button full-width" disabled={busy||files.length>3||hasProfanity}>{busy?'Kaydediliyor…':'Konumu kaydet'}</button><p className="info-text" style={{fontSize:"12px",color:"#94a3b8",marginTop:"10px",textAlign:"center"}}>Bilgilendirme: Paylaşımlarınız haritada 24 saat boyunca görünür kalır.</p></form>
        :<div className="empty-panel"><div className="panel-top-controls">{routeMode&&<section className="route-info-card" aria-live="polite"><div className="route-info-row"><div className="route-info-copy"><div className="route-info-heading"><Navigation size={16}/><h2>Rota Bilgisi</h2></div>{!routeStart?<p>Başlangıç noktası seçilmedi</p>:!routeEnd?<p>Bitiş noktası seçilmedi</p>:routeLoading?<p className="route-status"><LoaderCircle size={14} className="gps-spinner"/> Rota hesaplanıyor…</p>:routeInfo?<p className="route-summary">{routeInfo.distance} · ~{routeInfo.duration} · {routeInfo.pinsOnRoute.length} durak</p>:routeError?<p className="route-error" role="alert">{routeError}</p>:null}</div><div className="route-card-actions"><button type="button" className="secondary-button" onClick={()=>{setRouteStart(null);setRouteEnd(null);setRouteLine(null);setRouteInfo(null);setRouteError(null);setRouteLoading(false);}}>Rota Temizle</button></div></div>{routeInfo&&<p className="route-stop-hint">Duraklar başlangıçtan bitişe doğru sıralanır.</p>}</section>}<div className="panel-filter-search-row"><div className="panel-filters" onClick={event=>event.stopPropagation()} onMouseDown={event=>event.stopPropagation()}><div className={`category-filter-row ${showFilterOptions?'is-open':''}`} role="group" aria-label="Kategori filtresi" onClick={event=>event.stopPropagation()} onMouseDown={event=>event.stopPropagation()}>{!showFilterOptions?<><button type="button" className={`category-filter-button selected ${selectedCategoryFilter==='BENIM'?'my-pins-filter-button':''}`} style={{backgroundColor:categoryFilterColors[selectedCategoryFilter]??categoryFilterColors.Tümü,borderColor:categoryFilterColors[selectedCategoryFilter]??categoryFilterColors.Tümü,color:selectedCategoryFilter==='SARI'?'#111827':'#fff'}} onClick={()=>setShowFilterOptions(true)} aria-expanded="false" aria-label={`Seçili filtre: ${selectedCategoryFilter==='BENIM'?'Benim Pinlerim':selectedCategoryFilter}. Filtre seçeneklerini aç`}>{selectedCategoryFilter==='BENIM'&&<UserRound size={13} aria-hidden="true"/>}{selectedCategoryFilter==='BENIM'?'Benim Pinlerim':selectedCategoryFilter}</button><button type="button" className="filter-toggle-button" onClick={()=>setShowFilterOptions(true)} aria-label="Filtre seçeneklerini aç" title="Filtre seçenekleri"><SlidersHorizontal size={16}/></button></>:(session?.user?.id?['Tümü','YEŞİL','MAVİ','KIRMIZI','SARI','BENIM']:['Tümü','YEŞİL','MAVİ','KIRMIZI','SARI']).map(filter=><button key={filter} type="button" className={`category-filter-button ${selectedCategoryFilter===filter?'selected':''} ${filter==='BENIM'?'my-pins-filter-button':''}`} style={selectedCategoryFilter===filter?{backgroundColor:categoryFilterColors[filter],borderColor:categoryFilterColors[filter],color:filter==='SARI'?'#111827':'#fff'}:undefined} aria-pressed={selectedCategoryFilter===filter} onClick={()=>{setSelectedCategoryFilter(filter);setShowFilterOptions(false);}}>{filter==='BENIM'&&<UserRound size={13} aria-hidden="true"/>}{filter==='BENIM'?'Benim Pinlerim':filter}</button>)}</div><label className="time-filter-control" aria-label="Zaman filtresi" onClick={event=>event.stopPropagation()} onMouseDown={event=>event.stopPropagation()}><Clock size={15} aria-hidden="true"/><select value={timeFilter} onClick={event=>event.stopPropagation()} onMouseDown={event=>event.stopPropagation()} onChange={event=>setTimeFilter(event.target.value)} aria-label="Pinleri zamana göre filtrele"><option value="all">Tümü (24 Saat)</option><option value="1m">Son 1 Dakika</option><option value="15m">Son 15 Dakika</option><option value="30m">Son 30 Dakika</option><option value="1h">Son 1 Saat</option><option value="6h">Son 6 Saat</option><option value="12h">Son 12 Saat</option></select></label></div><div className="pin-searchbox"><Search size={15}/><input className={speechSupported?'voice-enabled-input':''} value={query} onChange={e=>setQuery(e.target.value)} placeholder={listeningField==='query'?'Dinleniyor...':'Açıklamalarda ara...'} aria-label="Açıklamalarda ara"/>{speechSupported&&<button type="button" className={`voice-button pin-voice-button ${listeningField==='query'?'is-listening':''}`} onClick={()=>startListening('query',setQuery)} aria-label={listeningField==='query'?'Dinlemeyi durdur':'Sesli pin araması'} title={listeningField==='query'?'Dinleniyor...':'Sesli arama'}><Mic size={15}/></button>}{query&&<button className="search-clear" type="button" onClick={()=>{setQuery('');setDebouncedQuery('');setSearchResultIds(null);}} aria-label="Pin aramasını temizle"><X size={14}/></button>}</div></div>{routeMode&&routeInfo&&routeOrderedPins.length>0&&<div className="route-stop-list-heading"><strong>Güzergâh durakları</strong><span>{routeOrderedPins.length} nokta</span></div>}</div>{filteredListPins.length===0&&timeFilter!=='all'&&filteredPins.length===0?<><div className="empty-icon"><Clock size={24}/></div><h2>Bu zaman aralığında nokta yok</h2><p>Daha geniş bir zaman aralığı seçebilir veya tüm son 24 saati görüntüleyebilirsin.</p></>:filteredListPins.length===0&&selectedCategoryFilter!=='Tümü'&&filteredPins.length===0?<><div className="empty-icon"><MapPin size={24}/></div><h2>Bu kategoride henüz nokta yok</h2><p>Başka bir kategori seçebilir veya yeni bir nokta ekleyebilirsin.</p></>:filteredListPins.length===0&&debouncedQuery.trim()?<><div className="empty-icon"><Search size={24}/></div><h2>Eşleşen nokta yok</h2><p>Farklı bir kelimeyle tekrar ara.</p></>:routeMode&&routeInfo&&routeOrderedPins.length===0?<><div className="empty-icon"><Navigation size={24}/></div><h2>Güzergâhta nokta yok</h2><p>Rota çizgisinin 100 metre yakınında paylaşılmış nokta bulunamadı.</p></>:pins.length===0?<><div className="empty-icon"><MapPin size={24}/></div><h2>İstanbul haritası</h2><p>{canAdd?'Haritada bir noktaya tıklayarak yeni paylaşım oluştur.':'Haritayı gezebilirsin.'}</p></>:<div className="pin-list" aria-label="Paylaşılan noktalar">{routeOrderedPins.map(({pin,routeOrder,routeDistance})=>{const first=[...(pin.pin_photos??[])].sort((a,b)=>a.sort_order-b.sort_order)[0];const title=pinTitle(pin);const score=pin.pin_votes?.reduce((sum,v)=>sum+v.vote_type,0)||0;return <button key={pin.id} type="button" className={`pin-list-item ${routeOrder!==null?'route-stop-item':''} ${selected?.id===pin.id?'is-selected':''}`} aria-label={routeOrder!==null?`${routeOrder}. durak: ${title}, haritada göster`:`Aç: ${title}`} onClick={()=>{setSelected(pin);setSearchPlace(null);setDraftPosition(null);setLightboxIndex(null);}}>{routeOrder!==null&&<span className="route-stop-number">{routeOrder}</span>}<div className="pin-list-left"><span className="pin-thumb">{first&&!thumbFailed[pin.id]?<LazyPinThumbnail path={first.storage_path} url={photoUrls[first.storage_path]} onVisible={ensurePhotoUrls} onError={()=>setThumbFailed(old=>({...old,[pin.id]:true}))} category={pin.category} />:<span className="mini-pin"><MapPin size={16} style={{ stroke: categoryFilterColors[normalizeCategory(pin.category)], color: categoryFilterColors[normalizeCategory(pin.category)] }} /></span>}</span><small className={`pin-category-label ${categoryClass(pin.category)}`}><span className="pin-category-dot"/>{normalizeCategory(pin.category)}</small></div><div className="pin-list-right"><strong className="pin-list-title" title={pinAddresses[pin.id]||title}>{pinAddresses[pin.id]||title||'Adres aranıyor...'}</strong><div className="pin-list-meta"><small>{routeDistance!==null?`${formatRouteDistance(routeDistance)} · `:''}{relativeTime(pin.created_at)} · {pin.pin_photos?.length??0} fotoğraf</small><span className={`pin-score-badge ${score>0?'score-pos':score<0?'score-neg':'score-zero'}`} aria-label={`Oy skoru: ${score}`}>{score>0?`+${score}`:score}</span></div></div></button>;})}</div>}{!session&&<button className="secondary-button full-width" onClick={()=>setAuthOpen(true)}>Hesap oluştur</button>}</div>}<div className="panel-footnote"><ShieldCheck size={15}/><span>Konum erişimi veritabanı politikalarıyla korunur.</span></div></aside>
    </section>
    
    {adminOpen && (
      <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setAdminOpen(false);}}>
        <div className="invite-modal" style={{ maxWidth: '800px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
          <div className="modal-head"><div><p className="eyebrow">YÖNETİCİ PANELİ</p><h2>Yönetim Merkezi</h2></div><button type="button" className="icon-button" onClick={()=>setAdminOpen(false)} aria-label="Kapat"><X size={18}/></button></div>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px' }}><button onClick={() => setAdminTab('users')} style={{ background: 'none', border: 'none', color: adminTab==='users'?'#fff':'#94a3b8', borderBottom: adminTab==='users'?'2px solid #3b82f6':'none', padding: '5px 10px', cursor: 'pointer', fontWeight: 'bold' }}>Kullanıcılar</button><button onClick={() => setAdminTab('reports')} style={{ background: 'none', border: 'none', color: adminTab==='reports'?'#fff':'#94a3b8', borderBottom: adminTab==='reports'?'2px solid #ef4444':'none', padding: '5px 10px', cursor: 'pointer', fontWeight: 'bold' }}>Raporlar ({adminReports.length})</button></div>
          {adminLoading ? <p style={{textAlign:'center', padding:'20px'}}>Yükleniyor...</p> : adminTab === 'users' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '20px' }}>{adminProfiles.map((p) => (<div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '10px 15px', borderRadius: '8px' }}><div><strong style={{ display: 'block', fontSize: '14px' }}>{p.username || `Kullanıcı: ${p.id.slice(0,8)}...`}</strong><span style={{ fontSize: '12px', color: p.status === 'active' ? '#4ade80' : p.status === 'disabled' ? '#f87171' : '#fbbf24' }}>Durum: {p.status === 'active' ? 'Aktif' : p.status === 'disabled' ? 'Banlı' : 'Onay Bekliyor'}</span>{p.role === 'admin' && <span style={{ marginLeft: '10px', fontSize: '10px', background: '#3b82f6', padding: '2px 6px', borderRadius: '4px' }}>ADMIN</span>}</div><div style={{ display: 'flex', gap: '8px' }}>{p.status !== 'active' && <button onClick={() => void updateUserStatus(p.id, 'active')} className="primary-button" style={{ padding: '6px 12px', fontSize: '12px' }}>Onayla</button>}{p.status === 'active' && p.role !== 'admin' && <button onClick={() => void updateUserStatus(p.id, 'disabled')} className="delete-pin-button" style={{ padding: '6px 12px', fontSize: '12px', marginTop: 0 }}>Banla</button>}</div></div>))}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '20px' }}>{adminReports.length === 0 && <p style={{textAlign:'center'}}>Harika, rapor edilen pin yok!</p>}{adminReports.map((r) => (<div key={r.id} style={{ display: 'flex', flexDirection: 'column', background: 'rgba(239, 68, 68, 0.1)', padding: '10px 15px', borderRadius: '8px', borderLeft: '4px solid #ef4444' }}><strong style={{ display: 'block', fontSize: '14px' }}>Şikayet Edilen Pin: {r.pin_description ? `${r.pin_description.slice(0,30)}...` : (r.pins?.description ? `${r.pins.description.slice(0,30)}...` : 'Açıklama Yok')}</strong><span style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>Tarih: {new Date(r.created_at).toLocaleDateString('tr-TR')}</span><div style={{ display: 'flex', gap: '8px' }}>{r.pin_id && (<button onClick={() => void resolveReport(r.id, 'delete')} className="delete-pin-button" style={{ padding: '6px 12px', fontSize: '12px', marginTop: 0 }}>Pini Sil ve Kapat</button>)}<button onClick={() => void resolveReport(r.id, 'ignore')} className="secondary-button" style={{ padding: '6px 12px', fontSize: '12px', marginTop: 0 }}>Yoksay</button></div></div>))}</div>
          )}
        </div>
      </div>
    )}

    {inviteOpen&&<div className="modal-backdrop invite-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setInviteOpen(false);}}><section className="invite-modal" role="dialog" aria-modal="true" aria-labelledby="invite-modal-title"><div className="modal-head"><div><p className="eyebrow">TOPLULUĞA DAVET</p><h2 id="invite-modal-title">Davet Kodlarım</h2></div><button type="button" className="icon-button" onClick={()=>setInviteOpen(false)} aria-label="Davet kodlarını kapat"><X size={18}/></button></div><p className="invite-intro">Kodlarını arkadaşlarınla paylaş. Her kod yalnızca bir hesap tarafından kullanılabilir.</p><button type="button" className="primary-button full-width invite-create" disabled={busy||!active||(profile?.role!=='admin'&&inviteCodes.length>=3)} onClick={()=>void createInviteCode()}><Plus size={17}/>{busy?'İşleniyor…':'Yeni Davet Kodu Üret'}</button>{profile?.role!=='admin'&&inviteCodes.length>=3&&<p className="invite-limit">Davet kodu limitinize ulaştınız.</p>}<div className="invite-list">{inviteCodes.length===0&&!busy?<div className="invite-empty">Henüz davet kodun yok. Yeni bir kod oluşturabilirsin.</div>:inviteCodes.map(item=><div className="invite-row" key={item.id}><div className="invite-code-info"><strong>{item.code||'Önceden oluşturulmuş davet kodu'}</strong><small>{new Date(item.created_at).toLocaleDateString('tr-TR')} · {item.redeemed_at?'Kullanıldı':item.is_enabled?'Kullanılabilir':'Devre dışı'}</small></div>{item.code&&!item.redeemed_at&&item.is_enabled&&<button type="button" className="copy-code-button" onClick={()=>void copyInviteCode(item)} aria-label="Davet kodunu kopyala" title="Kopyala">{copiedCodeId===item.id?<Check size={17}/>:<Copy size={17}/>}<span>{copiedCodeId===item.id?'Kopyalandı':'Kopyala'}</span></button>}</div>)}</div><p className="invite-footnote">Eski kodlar veritabanında yalnızca hash olarak saklanıyorsa tekrar görüntülenemez; yeni oluşturulan kodlar listeden kopyalanabilir.</p></section></div>}
    
    {lightboxIndex!==null&&selected&&selectedPhotos.length>0&&<div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label="Fotoğraf görüntüleyici" onTouchStart={e=>{(e.currentTarget as HTMLDivElement).dataset.touchX=String(e.touches[0].clientX);}} onTouchEnd={e=>{const start=Number((e.currentTarget as HTMLDivElement).dataset.touchX??0);const delta=e.changedTouches[0].clientX-start;if(Math.abs(delta)>45)setLightboxIndex(index=>index===null?null:delta<0?(index+1)%selectedPhotos.length:(index-1+selectedPhotos.length)%selectedPhotos.length);}} onMouseDown={e=>{if(e.target===e.currentTarget)setLightboxIndex(null);}}><button type="button" className="lightbox-close" onClick={()=>setLightboxIndex(null)} aria-label="Fotoğraf görüntüleyiciyi kapat"><X size={24}/></button>{selectedPhotos.length>1&&<button type="button" className="lightbox-nav lightbox-prev" onClick={()=>setLightboxIndex(index=>index===null?null:(index-1+selectedPhotos.length)%selectedPhotos.length)} aria-label="Önceki fotoğraf"><ChevronLeft size={30}/></button>}<img className="lightbox-image" src={photoUrls[selectedPhotos[lightboxIndex].storage_path]||''} alt={`Fotoğraf ${lightboxIndex+1} / ${selectedPhotos.length}`} loading="lazy" decoding="async"/>{selectedPhotos.length>1&&<button type="button" className="lightbox-nav lightbox-next" onClick={()=>setLightboxIndex(index=>index===null?null:(index+1)%selectedPhotos.length)} aria-label="Sonraki fotoğraf"><ChevronRight size={30}/></button>}<div className="lightbox-counter">{lightboxIndex+1} / {selectedPhotos.length}</div></div>}
    
    <footer><span>AYTAR</span><span>Harita verisi © OpenStreetMap katkıcıları</span><span>Ücretsiz açık kaynak bileşenlerle geliştirildi</span></footer>
    
    {authOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setAuthOpen(false);}}><div className="auth-modal"><div className="modal-head"><div><p className="eyebrow">{authMode==='login'?'TEKRAR HOŞ GELDİN':'TOPLULUĞA KATIL'}</p><h2>{authMode==='login'?'Giriş yap':'Hesap oluştur'}</h2></div><button className="icon-button" onClick={()=>setAuthOpen(false)} aria-label="Kapat"><X size={18}/></button></div><form onSubmit={submitAuth} className="auth-form"><label className="field-label" htmlFor="email">E-posta</label><input id="email" type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="ornek@eposta.com"/><label className="field-label" htmlFor="password">Şifre <span>en az 8 karakter</span></label><input id="password" type="password" minLength={8} required autoComplete={authMode==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="En az 8 karakter"/><button className="primary-button full-width" disabled={busy}>{busy?'İşleniyor…':authMode==='login'?'Giriş yap':'Kayıt ol'}</button></form><button className="text-button" onClick={()=>setAuthMode(authMode==='login'?'signup':'login')}>{authMode==='login'?'Hesabın yok mu? Kayıt ol':'Zaten hesabın var mı? Giriş yap'}</button>{!session&&<p className="modal-privacy">Kayıt sonrası hesabın otomatik olarak aktifleşir ve hemen kullanmaya başlayabilirsin.</p>}</div></div>}
  </main>;
}