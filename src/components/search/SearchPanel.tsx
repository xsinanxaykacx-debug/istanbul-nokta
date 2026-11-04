import { LoaderCircle, MapPin, Search, X } from 'lucide-react';

export type SearchPlaceResult = {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
};

type SearchPanelProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onFocus: () => void;
  loading: boolean;
  results: SearchPlaceResult[];
  searched: boolean;
  dropdownOpen: boolean;
  onDropdownOpenChange: (open: boolean) => void;
  listening: boolean;
  speechSupported: boolean;
  onClear: () => void;
  onSelect: (result: SearchPlaceResult) => void;
};

export default function SearchPanel({
  query,
  onQueryChange,
  onFocus,
  loading,
  results,
  searched,
  dropdownOpen,
  onDropdownOpenChange,
  listening,
  speechSupported,
  onClear,
  onSelect,
}: SearchPanelProps) {
  return (
    <div className="place-search-wrap">
      <div className="searchbox place-searchbox">
        <Search size={17}/>
        <input
          className={speechSupported ? 'voice-enabled-input' : ''}
          value={query}
          onFocus={onFocus}
          onChange={event => { onQueryChange(event.target.value); onDropdownOpenChange(true); }}
          placeholder={listening ? 'Dinleniyor...' : 'Mekan veya adres ara... (Örn: Galata Kulesi)'}
          aria-label="Mekan veya adres ara"
        />
        {loading && <LoaderCircle className="gps-spinner place-search-spinner" size={17}/>}
        {query && <button className="search-clear" type="button" onClick={onClear} aria-label="Mekan aramasını temizle"><X size={15}/></button>}
      </div>
      {dropdownOpen && query.trim() && (
        <div className="place-search-results" role="listbox">
          {loading
            ? <div className="place-search-status">Yerler aranıyor...</div>
            : results.length > 0
              ? results.map(result => (
                <button type="button" className="place-search-result" role="option" key={result.place_id} onClick={() => onSelect(result)}>
                  <MapPin size={16}/>
                  <span>{result.display_name.split(',').slice(0, 3).join(',')}</span>
                </button>
              ))
              : searched ? <div className="place-search-status">Sonuç bulunamadı</div> : null}
        </div>
      )}
    </div>
  );
}
