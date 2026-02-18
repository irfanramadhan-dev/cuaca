import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

/* ─────────────────────────────────────────────
   CUACA.LIVE
   Desktop  ≥1024px : 3-col, 1 screen, premium
   Mobile   <1024px : 2-card scroll (gaya lama)
   Auto-refresh     : setiap 5 menit silent
───────────────────────────────────────────── */

const F   = "'Outfit', sans-serif";
const NUM = { fontVariantNumeric:'tabular-nums', letterSpacing:'-0.03em' };
const glass = (ex={}) => ({
  background:'rgba(255,255,255,0.78)',
  border:'1px solid rgba(255,255,255,0.95)',
  borderRadius:20,
  backdropFilter:'blur(24px)',
  WebkitBackdropFilter:'blur(24px)',
  boxShadow:'0 4px 32px rgba(249,115,22,0.07),0 1px 4px rgba(0,0,0,0.04)',
  ...ex,
});

export default function WeatherMonitor() {
  const [weatherData,    setWeatherData]    = useState(null);
  const [historicalData, setHistoricalData] = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [location,       setLocation]       = useState({ city:'', country:'', coordinates:null });
  const [currentTime,    setCurrentTime]    = useState(new Date());
  const [lastUpdate,     setLastUpdate]     = useState(null);
  const [gpsStatus,      setGpsStatus]      = useState('detecting');
  const [weatherChanged, setWeatherChanged] = useState(false);
  const [loadingDots,    setLoadingDots]    = useState('');
  const [isDesktop,      setIsDesktop]      = useState(false);

  const prevCode  = useRef(null);
  const coordsRef = useRef(null);
  const timerRef  = useRef(null);

  /* ── viewport / zoom lock ─────────────────── */
  useEffect(() => {
    let m = document.querySelector('meta[name="viewport"]');
    if (!m) { m = document.createElement('meta'); m.name='viewport'; document.head.appendChild(m); }
    m.content = 'width=device-width,initial-scale=1,maximum-scale=1,minimum-scale=1,user-scalable=no,viewport-fit=cover';
    const pz = e => { if (e.touches?.length > 1) e.preventDefault(); };
    const pg = e => e.preventDefault();
    document.addEventListener('touchmove',    pz, { passive:false });
    document.addEventListener('gesturestart', pg, { passive:false });
    document.addEventListener('gesturechange',pg, { passive:false });
    return () => {
      document.removeEventListener('touchmove',    pz);
      document.removeEventListener('gesturestart', pg);
      document.removeEventListener('gesturechange',pg);
    };
  }, []);

  /* ── desktop breakpoint tracker ─────────── */
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mq.matches);
    const handler = e => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  /* ── clock ───────────────────────────────── */
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* ── loading dots ────────────────────────── */
  useEffect(() => {
    if (!loading) return;
    const d = setInterval(() => setLoadingDots(p => p.length>=3 ? '' : p+'.'), 400);
    return () => clearInterval(d);
  }, [loading]);

  /* ── helpers ─────────────────────────────── */
  const weatherDesc = useCallback(c => ({
    0:'Cerah',1:'Sebagian Cerah',2:'Berawan Sebagian',3:'Mendung',
    45:'Berkabut',48:'Kabut Tebal',51:'Gerimis Ringan',53:'Gerimis Sedang',55:'Gerimis Lebat',
    61:'Hujan Ringan',63:'Hujan Sedang',65:'Hujan Lebat',
    80:'Hujan Rintik',81:'Hujan Deras',82:'Hujan Sangat Deras',
    95:'Petir',96:'Petir + Hujan Es',99:'Badai Petir',
  }[c] ?? 'Tidak Diketahui'), []);

  const API = useCallback((lat,lon) =>
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,pressure_msl,precipitation` +
    `&hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability` +
    `&daily=precipitation_sum,precipitation_probability_max&forecast_days=1&timezone=auto`
  , []);

  const buildState = useCallback((data, code) => ({
    main: { temp:data.current.temperature_2m, humidity:data.current.relative_humidity_2m, pressure:data.current.pressure_msl },
    wind: { speed: data.current.wind_speed_10m / 3.6 },
    weather: [{ id:code, description:weatherDesc(code) }],
    precipitation: {
      daily_sum:   data.daily?.precipitation_sum?.[0]   ?? 0,
      probability: data.daily?.precipitation_probability_max?.[0] ?? 0,
    },
  }), [weatherDesc]);

  const buildChart = useCallback(data =>
    Array.from({ length:24 }, (_,i) => ({
      hour:i,
      temp:     data.hourly.temperature_2m[i]               ?? 0,
      humidity: data.hourly.relative_humidity_2m[i]         ?? 0,
      rain:     data.hourly.precipitation?.[i]              ?? 0,
      rainProb: data.hourly.precipitation_probability?.[i]  ?? 0,
    }))
  , []);

  const getLocationName = useCallback(async (lat, lon) => {
    const coords = { lat: lat.toFixed(4), lon: lon.toFixed(4) };

    try {
      const r = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=id`
      );
      const d = await r.json();
      if (d && (d.locality || d.city)) {
        const city    = d.locality || d.city || 'Lokasi Anda';
        const parent  = (d.city && d.city !== city) ? d.city : (d.principalSubdivision || '');
        const country = d.countryName || 'Indonesia';
        return { city, country: parent ? `${parent}, ${country}` : country, coordinates: coords };
      }
    } catch {}

    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=16&addressdetails=1&accept-language=id`
      );
      const d = await r.json(); const a = d.address || {};
      const city   = a.quarter||a.neighbourhood||a.suburb||a.village||a.town||a.city_district||a.district||a.city||a.county||'Lokasi Anda';
      const parent = a.city||a.town||a.county||a.state_district||a.state||'';
      return { city, country: parent ? `${parent}, ${a.country||'Indonesia'}` : (a.country||'Indonesia'), coordinates: coords };
    } catch {}

    return { city: 'Lokasi Anda', country: 'Indonesia', coordinates: coords };
  }, []);

  /* ── silent refresh (auto-update) ─────────── */
  const silentRefresh = useCallback(async (lat, lon) => {
    try {
      const res = await fetch(API(lat,lon));
      if (!res.ok) return;
      const data = await res.json();
      const code = data.current.weather_code;
      if (prevCode.current !== null && prevCode.current !== code) {
        setWeatherChanged(true);
        setTimeout(() => setWeatherChanged(false), 4000);
      }
      prevCode.current = code;
      setWeatherData(buildState(data, code));
      setHistoricalData(buildChart(data));
      setLastUpdate(new Date());
    } catch {}
  }, [API, buildState, buildChart]);

  /* ── first load ──────────────────────────── */
  const fetchWeather = useCallback(async (lat, lon) => {
    try {
      const res  = await fetch(API(lat,lon));
      const data = await res.json();
      const code = data.current.weather_code;
      prevCode.current = code;
      const loc = await getLocationName(lat, lon);
      setLocation(loc);
      setWeatherData(buildState(data, code));
      setHistoricalData(buildChart(data));
      setLastUpdate(new Date());
      setLoading(false);
    } catch { setLoading(false); }
  }, [API, buildState, buildChart, getLocationName]);

  const go = useCallback((lat, lon) => {
    coordsRef.current = { lat, lon };
    fetchWeather(lat, lon);
  }, [fetchWeather]);

  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) { setGpsStatus('unavailable'); go(-7.7956, 110.3695); return; }
    setGpsStatus('detecting');
    navigator.geolocation.getCurrentPosition(
      ({ coords:{ latitude:la, longitude:lo, accuracy } }) => {
        setGpsStatus(accuracy <= 100 ? 'accurate' : 'accurate');
        coordsRef.current={ lat:la, lon:lo };
        fetchWeather(la, lo);
      },
      (err) => {
        setGpsStatus('ip');
        const tryIP = async () => {
          const apis = [
            () => fetch('https://ipapi.co/json/').then(r=>r.json()).then(d=>({ lat:d.latitude, lon:d.longitude, ok:!!(d.latitude&&d.longitude) })),
            () => fetch('https://ip-api.com/json/?fields=lat,lon,status').then(r=>r.json()).then(d=>({ lat:d.lat, lon:d.lon, ok:d.status==='success' })),
            () => fetch('https://ipwho.is/').then(r=>r.json()).then(d=>({ lat:d.latitude, lon:d.longitude, ok:d.success })),
          ];
          for (const api of apis) {
            try {
              const { lat, lon, ok } = await api();
              if (ok && lat && lon) { coordsRef.current={lat,lon}; fetchWeather(lat, lon); return; }
            } catch {}
          }
          go(-7.7956, 110.3695);
        };
        tryIP();
      },
      { enableHighAccuracy:true, timeout:15000, maximumAge:0 }
    );
  }, [fetchWeather, go]);

  /* ── init ────────────────────────────────── */
  useEffect(() => { detectLocation(); }, [detectLocation]);

  /* ── AUTO-REFRESH ────────────────────────── */
  useEffect(() => {
    if (loading) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (coordsRef.current) {
        silentRefresh(coordsRef.current.lat, coordsRef.current.lon);
      }
    }, 5 * 60 * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loading, silentRefresh]);

  /* ── sub-components ────────────────────── */
  const WIcon = ({ code, size=36 }) => {
    const m={0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'⛈️',80:'🌧️',81:'⛈️',82:'⛈️',95:'⛈️',96:'⛈️',99:'⛈️'};
    return <span style={{ fontSize:size, lineHeight:1 }}>{m[code]||'🌡️'}</span>;
  };

  const Ring = ({ value, max, color, label, unit, size=80 }) => {
    const vb   = size * 2;                        // viewBox: e.g. 160 x 160
    const cx   = vb / 2;                          // center
    const R    = cx * 0.82;                       // actual SVG circle radius (matches r*1.9 ≈ 0.82*vb/2)
    const C    = 2 * Math.PI * R;                 // true circumference
    const pct  = Math.min(Math.max(value / max, 0), 1);
    const fill = pct * C;                         // arc length to fill
    const gap  = C - fill;                        // remaining empty arc
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
        <div style={{ position:'relative', width:size, height:size }}>
          <svg style={{ transform:'rotate(-90deg)', width:'100%', height:'100%' }} viewBox={`0 0 ${vb} ${vb}`}>
            <circle cx={cx} cy={cx} r={R} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={vb*0.045}/>
            <circle cx={cx} cy={cx} r={R} fill="none" stroke={color} strokeWidth={vb*0.045} strokeLinecap="round"
              strokeDasharray={`${fill} ${gap}`}
              strokeDashoffset={0}
              style={{ transition:'stroke-dasharray 1.8s cubic-bezier(.4,0,.2,1)' }}/>
          </svg>
          <div style={{ position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center' }}>
            <span style={{ fontFamily:F,fontWeight:800,fontSize:size*0.24,color:'#1e293b',lineHeight:1,...NUM }}>{Math.round(value)}</span>
            <span style={{ fontFamily:F,fontSize:size*0.115,color:'#94a3b8',marginTop:1 }}>{unit}</span>
          </div>
        </div>
        <span style={{ fontFamily:F,fontSize:size*0.115,fontWeight:700,letterSpacing:'0.07em',textTransform:'uppercase',color:'#94a3b8' }}>{label}</span>
      </div>
    );
  };

  // Desktop chart — hanya di-render saat isDesktop true (container punya dimensi nyata)
  const DeskChart = ({ data, color, dataKey, label }) => (
    <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
      <span style={{ fontFamily:F, fontSize:'0.6rem', fontWeight:700, color, marginBottom:2 }}>{label}</span>
      <div style={{ flex:1, minHeight:40 }}>
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <LineChart data={data} margin={{ top:2,right:2,left:2,bottom:2 }}>
            <YAxis hide domain={['dataMin-1','dataMax+1']}/>
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false}/>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  // Mobile chart — hanya di-render saat !isDesktop (container punya dimensi nyata)
  const MobChart = ({ data, color, dataKey, label }) => (
    <div>
      <p style={{ fontFamily:F, fontSize:'0.65rem', fontWeight:700, color, margin:'0 0 4px' }}>{label}</p>
      <div style={{ height:50, width:'100%' }}>
        <ResponsiveContainer width="100%" height={50} debounce={50}>
          <LineChart data={data} margin={{ top:3,right:4,left:4,bottom:3 }}>
            <YAxis hide domain={['dataMin-1','dataMax+1']}/>
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} dot={false} isAnimationActive={false}/>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  const StatPill = ({ label, value, unit, color, icon }) => (
    <div style={{ ...glass(), padding:'10px 12px', display:'flex', alignItems:'center', gap:10 }}>
      <div style={{ fontSize:'1.2rem', lineHeight:1, flexShrink:0 }}>{icon}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontFamily:F, fontSize:'0.58rem', color:'#94a3b8', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em' }}>{label}</div>
        <div style={{ fontFamily:F, fontWeight:800, fontSize:'1rem', color, ...NUM, lineHeight:1.1, marginTop:1 }}>
          {value}<span style={{ fontSize:'0.58rem', color:'#94a3b8', fontWeight:600, marginLeft:2 }}>{unit}</span>
        </div>
      </div>
    </div>
  );

  /* ── LOADING ─────────────────────────────── */
  if (loading) return (
    <div style={{ minHeight:'100dvh', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,#fff7ed,#fffbeb,#fef3c7)', fontFamily:F }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ position:'relative', width:76, height:76, margin:'0 auto 18px' }}>
          <svg style={{ position:'absolute',inset:0,width:'100%',height:'100%' }} viewBox="0 0 76 76">
            <circle cx="38" cy="38" r="30" fill="none" stroke="rgba(249,115,22,0.12)" strokeWidth="5"/>
          </svg>
          <svg style={{ position:'absolute',inset:0,width:'100%',height:'100%',animation:'spinCW 1.1s linear infinite' }} viewBox="0 0 76 76">
            <circle cx="38" cy="38" r="30" fill="none" stroke="#f97316" strokeWidth="5" strokeLinecap="round" strokeDasharray="188" strokeDashoffset="141"/>
          </svg>
          <svg style={{ position:'absolute',inset:10,width:'calc(100% - 20px)',height:'calc(100% - 20px)',animation:'spinCCW 0.7s linear infinite' }} viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="22" fill="none" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" strokeDasharray="138" strokeDashoffset="100"/>
          </svg>
          <div style={{ position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22 }}>📍</div>
        </div>
        <p style={{ fontWeight:800, fontSize:'1.05rem', color:'#1e293b', margin:0, letterSpacing:'-0.02em' }}>Mendeteksi Lokasi{loadingDots}</p>
        <p style={{ fontSize:'0.7rem', color:'#94a3b8', marginTop:5, margin:'6px 0 0' }}>
          {gpsStatus==='detecting'?'Izinkan akses GPS':gpsStatus==='ip'?'Menggunakan lokasi IP':'Memuat data cuaca...'}
        </p>
      </div>
      <style>{`@keyframes spinCW{to{transform:rotate(360deg)}}@keyframes spinCCW{to{transform:rotate(-360deg)}}`}</style>
    </div>
  );

  const timeStr = currentTime.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
  const secStr  = currentTime.toLocaleTimeString('id-ID', { second:'2-digit' }).replace(/.*:/,'');
  const dateStr = currentTime.toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  return (
    <div style={{ background:'linear-gradient(145deg,#fff7ed 0%,#fffbeb 50%,#fef9f0 100%)', fontFamily:F,
      minHeight:'100dvh',
      paddingTop:'env(safe-area-inset-top,0px)',
      paddingLeft:'env(safe-area-inset-left,0px)',
      paddingRight:'env(safe-area-inset-right,0px)',
    }}>

      {/* bg blobs */}
      <div style={{ position:'fixed',inset:0,pointerEvents:'none',overflow:'hidden',zIndex:0 }}>
        <div style={{ position:'absolute',top:'-10%',right:'-8%',width:'35vmax',height:'35vmax',borderRadius:'50%',background:'radial-gradient(circle,rgba(251,146,60,0.18),transparent 65%)',animation:'blob1 8s ease-in-out infinite' }}/>
        <div style={{ position:'absolute',bottom:'-8%',left:'-10%',width:'40vmax',height:'40vmax',borderRadius:'50%',background:'radial-gradient(circle,rgba(245,158,11,0.12),transparent 65%)',animation:'blob2 11s ease-in-out infinite 3s' }}/>
        <div style={{ position:'absolute',top:'40%',left:'30%',width:'20vmax',height:'20vmax',borderRadius:'50%',background:'radial-gradient(circle,rgba(99,102,241,0.06),transparent 65%)',animation:'blob1 14s ease-in-out infinite 6s' }}/>
      </div>

      {/* toast */}
      {weatherChanged && (
        <div style={{ position:'fixed',top:16,left:'50%',transform:'translateX(-50%)',zIndex:999,display:'flex',alignItems:'center',gap:6,background:'rgba(249,115,22,0.1)',border:'1px solid rgba(249,115,22,0.3)',borderRadius:50,padding:'7px 16px',backdropFilter:'blur(20px)',animation:'toastIn 0.4s cubic-bezier(.34,1.56,.64,1)',whiteSpace:'nowrap' }}>
          <span>🔄</span>
          <span style={{ fontWeight:700, fontSize:'0.75rem', color:'#ea580c' }}>Kondisi cuaca diperbarui!</span>
        </div>
      )}

      {/* ══════════════════════════════════════
          DESKTOP  ≥ 1024px
          ══════════════════════════════════════ */}
      <div className="desk" style={{ position:'relative',zIndex:1,height:'100dvh',overflow:'hidden',display:'none',flexDirection:'column',padding:'16px 20px',gap:12 }}>

        {/* top bar */}
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0 }}>
          <div>
            <div style={{ fontWeight:900,fontSize:'1.8rem',letterSpacing:'-0.04em',lineHeight:1 }}>
              <span style={{ background:'linear-gradient(135deg,#f97316,#f59e0b)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent' }}>Cuaca</span>
              <span style={{ color:'#1e293b' }}>.Live</span>
            </div>
            <div style={{ fontSize:'0.62rem',color:'#94a3b8',fontWeight:600,marginTop:2 }}>Pemantauan Cuaca Real-Time</div>
          </div>

          <div style={{ flex:1,display:'flex',justifyContent:'center' }}>
            <div style={{ ...glass(),display:'flex',alignItems:'center',gap:10,padding:'7px 18px' }}>
              <div style={{ width:6,height:6,borderRadius:'50%',background:gpsStatus==='accurate'?'#22c55e':'#f59e0b',animation:'livepulse 2s ease-in-out infinite',flexShrink:0 }}/>
              <span style={{ fontSize:'0.68rem',color:'#64748b',fontWeight:600 }}>{gpsStatus==='accurate'?'GPS Aktif':'🌐 Lokasi IP'}</span>
              <span style={{ width:1,height:14,background:'rgba(0,0,0,0.08)',display:'block' }}/>
              <span style={{ fontSize:'0.68rem',color:'#94a3b8',...NUM }}>{location.coordinates&&`${location.coordinates.lat}°, ${location.coordinates.lon}°`}</span>
              <span style={{ width:1,height:14,background:'rgba(0,0,0,0.08)',display:'block' }}/>
              <span style={{ fontSize:'0.68rem',color:'#94a3b8',fontWeight:500 }}>{dateStr}</span>
            </div>
          </div>

          <div style={{ ...glass({padding:'8px 18px',textAlign:'center'}) }}>
            <div style={{ fontSize:'0.5rem',color:'#94a3b8',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase' }}>WAKTU</div>
            <div style={{ fontWeight:900,fontSize:'2rem',color:'#f97316',lineHeight:1,...NUM }}>
              {timeStr}<span style={{ fontSize:'1rem',opacity:0.45 }}>{secStr}</span>
            </div>
          </div>
        </div>

        {/* 3-col */}
        <div style={{ flex:1,minHeight:0,display:'grid',gridTemplateColumns:'280px 1fr 1fr',gap:12 }}>

          {/* col 1: weather card */}
          <div style={{ ...glass({padding:'20px',display:'flex',flexDirection:'column',justifyContent:'space-between'}) }}>
            <div style={{ textAlign:'center' }}>
              <WIcon code={weatherData.weather[0].id} size={52}/>
              <div style={{ fontWeight:900,fontSize:'1.45rem',color:'#1e293b',letterSpacing:'-0.03em',lineHeight:1.1,marginTop:10 }}>{location.city}</div>
              <div style={{ fontSize:'0.65rem',color:'#94a3b8',marginTop:4 }}>📍 {location.country}</div>
              <div style={{ fontWeight:900,fontSize:'4.2rem',lineHeight:1,letterSpacing:'-0.05em',...NUM,background:'linear-gradient(135deg,#f97316,#f59e0b)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',margin:'10px 0 4px' }}>
                {weatherData.main.temp.toFixed(1)}°
              </div>
              <div style={{ fontWeight:600,fontSize:'0.85rem',color:'#64748b' }}>{weatherData.weather[0].description}</div>
            </div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:16 }}>
              {[
                { label:'Tekanan', value:`${Math.round(weatherData.main.pressure)}`, unit:'hPa', icon:'🌡', color:'#f97316' },
                { label:'Angin',   value:`${weatherData.wind.speed.toFixed(1)}`,      unit:'m/s', icon:'💨', color:'#0ea5e9' },
                { label:'Hujan',   value:`${weatherData.precipitation.daily_sum.toFixed(1)}`, unit:'mm', icon:'🌧', color:'#6366f1' },
                { label:'Peluang', value:`${weatherData.precipitation.probability}`,  unit:'%',  icon:'☔', color:'#8b5cf6' },
              ].map(({ label,value,unit,icon,color }) => (
                <div key={label} style={{ background:'rgba(0,0,0,0.025)',borderRadius:12,padding:'8px 10px',border:'1px solid rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize:'0.68rem' }}>{icon} <span style={{ fontSize:'0.56rem',color:'#94a3b8',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em' }}>{label}</span></div>
                  <div style={{ fontWeight:800,fontSize:'1.1rem',color,...NUM,lineHeight:1.1,marginTop:3 }}>
                    {value}<span style={{ fontSize:'0.58rem',color:'#94a3b8',fontWeight:600,marginLeft:2 }}>{unit}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop:12,paddingTop:10,borderTop:'1px solid rgba(0,0,0,0.05)',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
              <div style={{ display:'flex',alignItems:'center',gap:5 }}>
                <div style={{ width:5,height:5,borderRadius:'50%',background:'#22c55e',animation:'livepulse 2s ease-in-out infinite' }}/>
                <span style={{ fontSize:'0.58rem',color:'#94a3b8',fontWeight:600 }}>Open-Meteo API</span>
              </div>
              <span style={{ fontSize:'0.58rem',color:'#cbd5e1',...NUM }}>
                {lastUpdate&&`Upd. ${lastUpdate.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`}
              </span>
            </div>
          </div>

          {/* col 2: gauges */}
          <div style={{ ...glass({padding:'20px',display:'flex',flexDirection:'column'}) }}>
            <div style={{ fontWeight:800,fontSize:'1.05rem',color:'#1e293b',letterSpacing:'-0.02em',marginBottom:16 }}>Metrik Real-Time</div>
            <div style={{ flex:1,display:'flex',flexDirection:'column',justifyContent:'space-around' }}>
              <div style={{ display:'flex',justifyContent:'space-around',alignItems:'center' }}>
                <Ring value={weatherData.main.temp} max={50} color="#f97316" label="Suhu" unit="°C" size={100}/>
                <Ring value={weatherData.main.humidity} max={100} color="#f59e0b" label="Kelembaban" unit="%" size={100}/>
                <Ring value={weatherData.precipitation.probability} max={100} color="#6366f1" label="Hujan" unit="%" size={100}/>
              </div>
              <div style={{ height:1,background:'rgba(0,0,0,0.05)',margin:'8px 0' }}/>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
                <StatPill label="Tekanan Udara"  value={Math.round(weatherData.main.pressure)}              unit="hPa" color="#f97316" icon="🌡"/>
                <StatPill label="Kecepatan Angin" value={weatherData.wind.speed.toFixed(1)}                 unit="m/s" color="#0ea5e9" icon="💨"/>
                <StatPill label="Curah Hujan"    value={weatherData.precipitation.daily_sum.toFixed(1)}     unit="mm"  color="#6366f1" icon="🌧"/>
                <StatPill label="Peluang Hujan"  value={weatherData.precipitation.probability}              unit="%"   color="#8b5cf6" icon="☔"/>
              </div>
            </div>
          </div>

          {/* col 3: charts — hanya render saat isDesktop */}
          <div style={{ ...glass({padding:'20px',display:'flex',flexDirection:'column'}) }}>
            <div style={{ fontWeight:800,fontSize:'1.05rem',color:'#1e293b',letterSpacing:'-0.02em',marginBottom:10 }}>Perubahan 24 Jam</div>
            <div style={{ flex:1,minHeight:0,display:'flex',flexDirection:'column',gap:8 }}>
              {isDesktop && <>
                <DeskChart data={historicalData} color="#f97316" dataKey="temp"     label="↗ Suhu (°C)"/>
                <div style={{ height:1,background:'rgba(0,0,0,0.04)',flexShrink:0 }}/>
                <DeskChart data={historicalData} color="#f59e0b" dataKey="humidity" label="💧 Kelembaban (%)"/>
                <div style={{ height:1,background:'rgba(0,0,0,0.04)',flexShrink:0 }}/>
                <DeskChart data={historicalData} color="#6366f1" dataKey="rain"     label="🌧 Curah Hujan (mm)"/>
                <div style={{ height:1,background:'rgba(0,0,0,0.04)',flexShrink:0 }}/>
                <DeskChart data={historicalData} color="#ec4899" dataKey="rainProb" label="☔ Peluang Hujan (%)"/>
              </>}
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════
          MOBILE  < 1024px
          ══════════════════════════════════════ */}
      <div className="mob" style={{ position:'relative',zIndex:1,
        padding:'clamp(8px,3vw,20px)',
        paddingTop:'max(clamp(8px,3vw,20px), env(safe-area-inset-top,8px))',
        paddingBottom:'max(20px, env(safe-area-inset-bottom,20px))',
        maxWidth:520, margin:'0 auto', display:'flex', flexDirection:'column', gap:12,
      }}>

        {/* header */}
        <header style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <div>
            <div style={{ fontWeight:900,fontSize:'clamp(1.4rem,5vw,2rem)',letterSpacing:'-0.03em',lineHeight:1.1 }}>
              <span style={{ background:'linear-gradient(135deg,#f97316,#f59e0b)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent' }}>Cuaca</span>
              <span style={{ color:'#1e293b' }}>.Live</span>
            </div>
            <p style={{ fontSize:'0.72rem',fontWeight:500,color:'#94a3b8',margin:'2px 0 0' }}>Pemantauan Real-Time</p>
          </div>
          <div style={{ ...glass({padding:'6px 14px',textAlign:'center',minWidth:72}) }}>
            <p style={{ fontSize:'0.55rem',fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:'#94a3b8',margin:0 }}>WAKTU</p>
            <p style={{ fontFamily:F,fontWeight:800,fontSize:'clamp(1.1rem,4.5vw,1.45rem)',color:'#f97316',...NUM,lineHeight:1,margin:0 }}>
              {timeStr}
            </p>
          </div>
        </header>

        {/* GPS bar */}
        <div style={{ ...glass({padding:'6px 14px',display:'flex',alignItems:'center',justifyContent:'space-between'}) }}>
          <div style={{ display:'flex',alignItems:'center',gap:7 }}>
            <div style={{ width:6,height:6,borderRadius:'50%',flexShrink:0,background:gpsStatus==='accurate'?'#22c55e':'#f59e0b',animation:'livepulse 2s ease-in-out infinite' }}/>
            <span style={{ fontSize:'0.7rem',color:'#64748b',fontWeight:600 }}>
              {gpsStatus==='accurate'?'GPS Aktif':gpsStatus==='ip'?'🌐 Lokasi via IP':'Mendeteksi...'}
            </span>
          </div>
          <span style={{ fontSize:'0.6rem',color:'#94a3b8',...NUM }}>
            {location.coordinates&&`${location.coordinates.lat}°, ${location.coordinates.lon}°`}
          </span>
        </div>

        {/* card 1: weather */}
        <div style={{ ...glass({padding:'clamp(14px,4vw,20px)'}), borderRadius:24 }}>
          <div style={{ textAlign:'center', paddingBottom:12 }}>
            <WIcon code={weatherData.weather[0].id} size={42}/>
            <h2 style={{ fontWeight:900,fontSize:'clamp(1.3rem,5vw,1.8rem)',color:'#1e293b',letterSpacing:'-0.02em',margin:'8px 0 2px' }}>{location.city}</h2>
            <p style={{ fontSize:'0.7rem',color:'#94a3b8',margin:'0 0 6px' }}>{location.country}</p>
            <div style={{ fontWeight:900,fontSize:'clamp(3rem,12vw,4.5rem)',lineHeight:1,letterSpacing:'-0.05em',...NUM,background:'linear-gradient(135deg,#f97316,#f59e0b)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',margin:'4px 0' }}>
              {weatherData.main.temp.toFixed(1)}°
            </div>
            <p style={{ fontWeight:600,fontSize:'0.88rem',color:'#64748b',margin:0 }}>{weatherData.weather[0].description}</p>
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,paddingTop:14,borderTop:'1px solid rgba(0,0,0,0.05)' }}>
            {[
              { label:'Tekanan Udara',  value:`${Math.round(weatherData.main.pressure)} hPa` },
              { label:'Kecepatan Angin', value:`${weatherData.wind.speed.toFixed(1)} m/s` },
              { label:'Curah Hujan',    value:`${weatherData.precipitation.daily_sum.toFixed(1)} mm` },
              { label:'Peluang Hujan',  value:`${weatherData.precipitation.probability}%` },
            ].map(({ label,value }) => (
              <div key={label} style={{ background:'rgba(0,0,0,0.025)',borderRadius:14,padding:'10px 12px',border:'1px solid rgba(0,0,0,0.04)' }}>
                <p style={{ fontSize:'0.62rem',color:'#94a3b8',margin:'0 0 2px' }}>{label}</p>
                <p style={{ fontWeight:700,fontSize:'clamp(0.88rem,3.2vw,1rem)',...NUM,color:'#1e293b',margin:0 }}>{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* card 2: metrics */}
        <div style={{ ...glass({padding:'clamp(14px,4vw,20px)',display:'flex',flexDirection:'column'}), borderRadius:24 }}>
          <h3 style={{ fontWeight:800,fontSize:'clamp(1rem,3.5vw,1.2rem)',color:'#1e293b',letterSpacing:'-0.02em',margin:'0 0 14px' }}>Metrik Real-Time</h3>

          <div style={{ display:'flex',justifyContent:'space-around',alignItems:'center',marginBottom:16 }}>
            <Ring value={weatherData.main.temp} max={50} color="#f97316" label="Suhu" unit="°C" size={80}/>
            <Ring value={weatherData.main.humidity} max={100} color="#f59e0b" label="Kelembaban" unit="%" size={80}/>
            <Ring value={weatherData.precipitation.probability} max={100} color="#6366f1" label="Hujan" unit="%" size={80}/>
          </div>

          {/* Charts — hanya render saat !isDesktop */}
          <div style={{ display:'flex',flexDirection:'column',gap:4 }}>
            {!isDesktop && <>
              <MobChart data={historicalData} color="#f97316" dataKey="temp"     label="Suhu (24 Jam)"/>
              <MobChart data={historicalData} color="#f59e0b" dataKey="humidity" label="Kelembaban (24 Jam)"/>
              <MobChart data={historicalData} color="#6366f1" dataKey="rain"     label="Curah Hujan per Jam (mm)"/>
              <MobChart data={historicalData} color="#ec4899" dataKey="rainProb" label="Peluang Hujan (%)"/>
            </>}
          </div>
        </div>

        {/* footer */}
        <footer style={{ paddingTop:10,borderTop:'1px solid rgba(0,0,0,0.06)',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',alignItems:'center',gap:4 }}>
          <div style={{ display:'flex',alignItems:'center',gap:6 }}>
            <div style={{ width:6,height:6,borderRadius:'50%',flexShrink:0,background:'#22c55e',animation:'livepulse 2s ease-in-out infinite' }}/>
            <div>
              <p style={{ fontSize:'0.6rem',fontWeight:700,color:'#94a3b8',margin:0 }}>Sumber Data</p>
              <p style={{ fontSize:'0.58rem',color:'#cbd5e1',margin:0 }}>Open-Meteo API</p>
            </div>
          </div>
          <div style={{ textAlign:'center' }}>
            <p style={{ fontSize:'0.58rem',color:'#94a3b8',margin:0,...NUM }}>
              {location.coordinates&&`${location.coordinates.lat}, ${location.coordinates.lon}`}
            </p>
            <p style={{ fontSize:'0.58rem',color:'#cbd5e1',margin:0,...NUM }}>
              {lastUpdate&&`Update: ${lastUpdate.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`}
            </p>
          </div>
          <div style={{ textAlign:'right' }}>
            <p style={{ fontSize:'0.6rem',fontWeight:700,color:'#94a3b8',margin:0 }}>
              {new Date().toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}
            </p>
            <p style={{ fontSize:'0.58rem',color:'#cbd5e1',margin:0 }}>Real-Time</p>
          </div>
        </footer>

      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap');
        *, *::before, *::after { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
        html { touch-action:manipulation; -webkit-text-size-adjust:100%; }
        body { margin:0; padding:0; overscroll-behavior:none; }

        .desk { display:none !important; }
        .mob  { display:flex !important; }
        @media (min-width:1024px) {
          .desk { display:flex !important; }
          .mob  { display:none !important; }
        }

        @keyframes spinCW    { to { transform:rotate(360deg);  } }
        @keyframes spinCCW   { to { transform:rotate(-360deg); } }
        @keyframes livepulse { 0%,100%{opacity:.4;transform:scale(1)} 50%{opacity:1;transform:scale(1.5)} }
        @keyframes blob1     { 0%,100%{transform:translate(0,0)scale(1)} 50%{transform:translate(-15px,20px)scale(1.07)} }
        @keyframes blob2     { 0%,100%{transform:translate(0,0)scale(1)} 50%{transform:translate(18px,-15px)scale(1.05)} }
        @keyframes toastIn   { from{opacity:0;transform:translateX(-50%)translateY(-10px)scale(.9)} to{opacity:1;transform:translateX(-50%)translateY(0)scale(1)} }
        @keyframes pulse     { 0%,100%{opacity:.3;transform:scale(1)} 50%{opacity:.7;transform:scale(1.05)} }
      `}</style>
    </div>
  );
}