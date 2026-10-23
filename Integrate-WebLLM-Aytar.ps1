$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\bzdye\Downloads\istanbul-pin-pwa'
$app = Join-Path $repo 'src\App.tsx'
if (-not (Test-Path -LiteralPath $app)) { throw "Dosya bulunamadı: $app" }
Set-Location $repo
$source = [System.IO.File]::ReadAllText($app, [System.Text.UTF8Encoding]::new($false))
if ($source.Contains('WebLLM komutu çözemedi')) { throw 'WebLLM entegrasyonu zaten dosyada görünüyor; dosyaya tekrar dokunulmadı.' }
$backup = "$app.webllm-backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
[System.IO.File]::Copy($app, $backup, $false)

$refsNeedle = 'const voicePinTimeoutRef=useRef<number|undefined>(undefined);'
if (-not $source.Contains($refsNeedle)) { throw 'Beklenen voicePinTimeoutRef satırı bulunamadı. Dosya değiştirilmedi; yedek oluşturuldu: ' + $backup }
$refsReplacement = @'
const voicePinTimeoutRef=useRef<number|undefined>(undefined);
  const webLlmEngineRef=useRef<any>(null);
  const webLlmReadyRef=useRef(false);
'@
$source = $source.Replace($refsNeedle, $refsReplacement.TrimEnd())

$effectNeedle = '  const mapRef = useRef<L.Map | null>(null);'
if (-not $source.Contains($effectNeedle)) { throw 'Beklenen mapRef satırı bulunamadı. Dosya değiştirilmedi; yedek: ' + $backup }
$effect = @'
  useEffect(() => {
    let cancelled = false;
    const loadWebLlm = async () => {
      if (!('gpu' in navigator)) {
        console.info('WebGPU kullanılamıyor; sesli komutlarda mevcut regex ayrıştırıcısı kullanılacak.');
        return;
      }
      try {
        const moduleUrl = 'https://esm.sh/@mlc-ai/web-llm';
        const webllm = await import(/* @vite-ignore */ moduleUrl);
        const engine = await webllm.CreateMLCEngine('Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
        if (cancelled) {
          await engine?.unload?.();
          return;
        }
        webLlmEngineRef.current = engine;
        webLlmReadyRef.current = true;
        console.info('WebLLM sesli komut modeli hazır.');
      } catch (error) {
        webLlmReadyRef.current = false;
        webLlmEngineRef.current = null;
        console.warn('WebLLM yüklenemedi; mevcut regex sesli komut sistemi çalışmaya devam edecek.', error);
      }
    };
    void loadWebLlm();
    return () => {
      cancelled = true;
      const engine = webLlmEngineRef.current;
      webLlmEngineRef.current = null;
      webLlmReadyRef.current = false;
      if (engine?.unload) void engine.unload().catch(() => {});
    };
  }, []);

'@
$source = $source.Replace($effectNeedle, $effect + $effectNeedle)

$parserNeedle = 'function parseVoicePinCommand(transcript:string):VoiceCommand|null{'
if (-not $source.Contains($parserNeedle)) { throw 'parseVoicePinCommand fonksiyonu bulunamadı. Dosya değiştirilmedi; yedek: ' + $backup }
$source = $source.Replace($parserNeedle, 'function parseVoicePinCommandRegex(transcript:string):VoiceCommand|null{')

$startNeedle = 'function startVoicePinCommand'
$startIndex = $source.IndexOf($startNeedle)
if ($startIndex -lt 0) { throw 'startVoicePinCommand fonksiyonu bulunamadı. Dosya değiştirilmedi; yedek: ' + $backup }
$wrapper = @'
async function parseVoicePinCommand(transcript:string):Promise<VoiceCommand|null>{
  const regexCommand=parseVoicePinCommandRegex(transcript);
  if(regexCommand) return regexCommand;
  const engine=webLlmEngineRef.current;
  if(!webLlmReadyRef.current||!engine) return null;
  try {
    const response=await engine.chat.completions.create({
      messages:[
        {role:'system',content:'Sen bir harita asistanısın. Kullanıcının cümlesini şu komutlardan birine eşle: TRAFFIC_ACIK, TRAFFIC_KAPALI, ROTA, ARAMA, PIN_SIL, ZOOM_IN, ZOOM_OUT, TEMA_GECE, TEMA_GUNDUZ. Sadece komut adını döndür.'},
        {role:'user',content:`Cümle: ${transcript}`}
      ],
      temperature:0,
      max_tokens:16
    });
    const answer=String(response?.choices?.[0]?.message?.content??'').trim().toLocaleUpperCase('en-US').replace(/[^A-Z_]/g,'');
    const normalized=transcript.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
    switch(answer){
      case 'TRAFFIC_ACIK': return {type:'TRAFFIC',enabled:true};
      case 'TRAFFIC_KAPALI': return {type:'TRAFFIC',enabled:false};
      case 'ROTA': {
        const destination=normalized.replace(/\b(?:bana|lütfen|rota|oluştur|çiz|çizer misin|gitmek istiyorum|yol tarifi|götür|gider misin)\b/g,' ').replace(/\s+/g,' ').trim();
        return destination?{type:'ROUTE',destination}:null;
      }
      case 'ARAMA': {
        const query=normalized.replace(/\b(?:bana|lütfen|ara|arama yap|bul|bulur musun|göster|konumu bul|yerini bul|ara lütfen)\b/g,' ').replace(/\s+/g,' ').trim();
        return query?{type:'SEARCH_PLACE',query}:null;
      }
      case 'PIN_SIL': return {type:'DELETE_PIN',target:/(?:konumum|konumuma|konumumdaki|buradaki|yakınımdaki|yakınımda)/.test(normalized)?'nearest':'selected'};
      case 'ZOOM_IN': return {type:'ZOOM',action:'in'};
      case 'ZOOM_OUT': return {type:'ZOOM',action:'out'};
      case 'TEMA_GECE': return {type:'THEME',mode:'dark'};
      case 'TEMA_GUNDUZ': return {type:'THEME',mode:'light'};
      default: return null;
    }
  } catch(error) {
    console.warn('WebLLM komutu çözemedi; regex sonucu null olarak bırakılıyor.',error);
    return null;
  }
}

'@
$source = $source.Insert($startIndex, $wrapper)
$callNeedle = 'const command=parseVoicePinCommand(transcript);'
if (-not $source.Contains($callNeedle)) { throw 'Komut ayrıştırıcı çağrısı bulunamadı. Dosya değiştirilmedi; yedek: ' + $backup }
$source = $source.Replace($callNeedle, 'const command=await parseVoicePinCommand(transcript);')

[System.IO.File]::WriteAllText($app, $source, [System.Text.UTF8Encoding]::new($false))
Write-Host "WebLLM değişikliği yalnızca src/App.tsx dosyasına uygulandı."
Write-Host "Yedek: $backup"
Write-Host 'Build başlatılıyor: npm run build'
& npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build başarısız oldu (exit code $LASTEXITCODE). Değişiklikler yerelde duruyor; yedek: $backup" }
Write-Host 'BUILD PASS'
Write-Host 'Git commit veya push yapılmadı.'
