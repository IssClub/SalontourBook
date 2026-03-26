import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

// ── Helpers ────────────────────────────────────────────────────
const todayStr  = () => new Date().toISOString().slice(0, 10)
const t2m       = t  => { const [h,m] = t.split(':').map(Number); return h*60+(m||0) }
const m2t       = m  => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
const isOnVac   = (vacs, pid, ds) => vacs.some(v => v.provider_id===pid && ds>=v.from_date && ds<=v.to_date)
const isClosed  = (s, ds) => (s.closed_dates||[]).some(r => typeof r==='string' ? r===ds : ds>=r.from && ds<=r.to)
const allOnVac  = (vacs, provs, ds) => provs.length > 0 && provs.every(p => isOnVac(vacs, p.id, ds))
const dayHours  = (ds, s) => { const dow=new Date(ds+'T12:00:00').getDay(); const ov=s.day_hours?.[dow]; return ov?{open:ov.open,close:ov.close}:{open:s.open_mins,close:s.close_mins} }
const slotTaken = (appts, ds, time, dur, pid) => {
  const s=t2m(time), e=s+dur
  return appts.some(a => { if(a.date!==ds||a.provider_id!==pid) return false; const as=t2m(a.time),ae=as+a.duration; return s<ae&&e>as })
}
const MONS  = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']
const DAY_S = ['א','ב','ג','ד','ה','ו','ש']
const PCOLS = {'1':'#c9956a','2':'#6a9bc9','3':'#c96a9b','4':'#6ac98b','5':'#c9a56a','6':'#9b6ac9'}

function buildMonthCells(year, month) {
  const first    = new Date(year, month, 1).getDay()
  const days     = new Date(year, month+1, 0).getDate()
  const prevDays = new Date(year, month, 0).getDate()
  const cells    = []
  for (let i=first-1; i>=0; i--) cells.push({ dom: prevDays-i, ds: null })
  for (let d=1; d<=days; d++) {
    const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    cells.push({ dom: d, ds, dow: new Date(ds+'T12:00:00').getDay() })
  }
  const total = Math.ceil((first+days)/7)*7
  for (let i=1; i<=total-(first+days); i++) cells.push({ dom: i, ds: null })
  return cells
}

// ── Main App ───────────────────────────────────────────────────
export default function App() {
  const [loading,     setLoading]     = useState(true)
  const [settings,    setSettings]    = useState(null)
  const [providers,   setProviders]   = useState([])
  const [appts,       setAppts]       = useState([])
  const [vacations,   setVacations]   = useState([])

  const [step,        setStep]        = useState(1)
  const [selDate,     setSelDate]     = useState('')
  const [selProv,     setSelProv]     = useState(null)
  const [selTime,     setSelTime]     = useState('')
  const [selService,  setSelService]  = useState('')
  const [clientName,  setClientName]  = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [clientNote,  setClientNote]  = useState('')
  const [submitting,  setSubmitting]  = useState(false)
  const [bookingRef,  setBookingRef]  = useState(null)

  const now = new Date()
  const [viewYear,  setViewYear]  = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())

  useEffect(() => {
    async function load() {
      const [s, p, a, v] = await Promise.all([
        supabase.from('settings').select('*').single(),
        supabase.from('providers').select('*').order('sort_order'),
        supabase.from('appointments').select('date,time,duration,provider_id,status').gte('date', todayStr()),
        supabase.from('vacations').select('*'),
      ])
      if (s.data) setSettings(s.data)
      if (p.data) setProviders(p.data)
      if (a.data) setAppts(a.data)
      if (v.data) setVacations(v.data)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return (
    <div className="page-center">
      <div className="spinner" />
      <div style={{ marginTop: 16, color: '#999', fontSize: 14 }}>טוען...</div>
    </div>
  )

  if (!settings) return (
    <div className="page-center"><div style={{ color: '#999' }}>שגיאה בטעינה</div></div>
  )

  const salonName = settings.salon_name || 'הסלון'
  const dur       = settings.default_duration || 30

  // ── Step 1: Pick date ────────────────────────────────────────
  if (step === 1) {
    const cells  = buildMonthCells(viewYear, viewMonth)
    const td     = todayStr()

    function prevM() { if (viewMonth===0) { setViewYear(y=>y-1); setViewMonth(11) } else setViewMonth(m=>m-1) }
    function nextM() { if (viewMonth===11) { setViewYear(y=>y+1); setViewMonth(0) } else setViewMonth(m=>m+1) }

    return (
      <div className="wrap">
        <div className="salon-hdr">
          <div className="salon-logo">✂</div>
          <div className="salon-name">{salonName}</div>
          <div className="salon-sub">בחר תאריך לתור</div>
        </div>

        <div className="card">
          <div className="cal-nav">
            <button className="cal-arr" onClick={prevM}>›</button>
            <span className="cal-month-lbl">{MONS[viewMonth]} {viewYear}</span>
            <button className="cal-arr" onClick={nextM}>‹</button>
          </div>
          <div className="cal-dow">
            {DAY_S.map(d => <div key={d}>{d}</div>)}
          </div>
          <div className="cal-grid">
            {cells.map((c, i) => {
              if (!c.ds) return <div key={i} className="cal-day other" />
              const isWork    = settings.work_days?.includes(c.dow)
              const isPast    = c.ds < td
              const disabled  = !isWork || isPast || isClosed(settings, c.ds) || allOnVac(vacations, providers, c.ds)
              const isToday   = c.ds === td
              return (
                <div
                  key={c.ds}
                  className={`cal-day${disabled ? ' off' : ' on'}${isToday ? ' today' : ''}`}
                  onClick={() => !disabled && (setSelDate(c.ds), setStep(2))}
                >{c.dom}</div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // ── Step 2: Pick provider ────────────────────────────────────
  if (step === 2) {
    const avail = providers.filter(p => !isOnVac(vacations, p.id, selDate))
    const d2    = new Date(selDate + 'T12:00:00')
    const label = `${d2.getDate()} ${MONS[d2.getMonth()]}`

    return (
      <div className="wrap">
        <div className="step-hdr">
          <button className="back-btn" onClick={() => setStep(1)}>‹</button>
          <div>
            <div className="step-title">בחר מטפל/ת</div>
            <div className="step-sub">📅 {label}</div>
          </div>
        </div>

        {avail.length === 0 ? (
          <div className="card center-msg">
            <div style={{ fontSize: 32 }}>🏖</div>
            <div>אין זמינות ביום זה</div>
            <button className="btn-outline" onClick={() => setStep(1)}>בחר תאריך אחר</button>
          </div>
        ) : (
          <div className="prov-list">
            {avail.map(p => (
              <button
                key={p.id}
                className="prov-card"
                style={{ borderColor: PCOLS[p.color] }}
                onClick={() => { setSelProv(p); setStep(3) }}
              >
                <div className="prov-av" style={{ background: PCOLS[p.color] }}>{p.name[0]}</div>
                <div className="prov-name">{p.name}</div>
                <div className="prov-arr">›</div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Step 3: Pick time ────────────────────────────────────────
  if (step === 3) {
    const { open, close } = dayHours(selDate, settings)
    const slots = []
    for (let m = open; m + dur <= close; m += 30) {
      const time = m2t(m)
      if (!slotTaken(appts, selDate, time, dur, selProv.id)) slots.push(time)
    }
    const d2    = new Date(selDate + 'T12:00:00')
    const label = `${d2.getDate()} ${MONS[d2.getMonth()]}`
    const col   = PCOLS[selProv.color]

    return (
      <div className="wrap">
        <div className="step-hdr">
          <button className="back-btn" onClick={() => setStep(2)}>‹</button>
          <div>
            <div className="step-title">בחר שעה</div>
            <div className="step-sub">📅 {label} · <span style={{ color: col }}>● {selProv.name}</span></div>
          </div>
        </div>

        {slots.length === 0 ? (
          <div className="card center-msg">
            <div style={{ fontSize: 32 }}>📭</div>
            <div>אין מקומות פנויים ביום זה</div>
            <button className="btn-outline" onClick={() => setStep(1)}>בחר תאריך אחר</button>
          </div>
        ) : (
          <div className="card">
            <div className="slots-grid">
              {slots.map(t => (
                <button
                  key={t}
                  className="slot-btn"
                  style={{ '--col': col }}
                  onClick={() => { setSelTime(t); setStep(4) }}
                >{t}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Step 4: Details ──────────────────────────────────────────
  if (step === 4) {
    const d2    = new Date(selDate + 'T12:00:00')
    const label = `${d2.getDate()} ${MONS[d2.getMonth()]}`
    const col   = PCOLS[selProv.color]
    const svcs  = settings.services || []

    async function submit() {
      if (!clientName.trim() || !clientPhone.trim()) return
      setSubmitting(true)
      try {
        // Upsert client
        const existing = await supabase.from('clients')
          .select('id').eq('name', clientName.trim()).maybeSingle()
        let clientId = existing.data?.id
        if (!clientId) {
          const ins = await supabase.from('clients')
            .insert({ name: clientName.trim(), phone: clientPhone.trim(), note: '' })
            .select('id').single()
          clientId = ins.data?.id
        }

        const { data, error } = await supabase.from('appointments').insert({
          client_name: clientName.trim(),
          client_id:   clientId,
          phone:       clientPhone.trim(),
          service:     selService,
          date:        selDate,
          time:        selTime,
          duration:    dur,
          provider_id: selProv.id,
          note:        clientNote.trim(),
          status:      'pending',
        }).select('id').single()

        if (error) throw error
        setBookingRef({ date: label, time: selTime, prov: selProv.name, service: selService })
        setStep(5)
      } catch {
        alert('שגיאה בשמירת התור, נסה שוב')
      } finally {
        setSubmitting(false)
      }
    }

    const valid = clientName.trim().length >= 2 && clientPhone.trim().length >= 9

    return (
      <div className="wrap">
        <div className="step-hdr">
          <button className="back-btn" onClick={() => setStep(3)}>‹</button>
          <div>
            <div className="step-title">פרטים אישיים</div>
            <div className="step-sub">📅 {label} · {selTime} · <span style={{ color: col }}>● {selProv.name}</span></div>
          </div>
        </div>

        <div className="card form-card">
          <div className="field">
            <label>שם מלא *</label>
            <input
              className="inp"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
              placeholder="ישראל ישראלי"
              autoComplete="name"
            />
          </div>
          <div className="field">
            <label>טלפון *</label>
            <input
              className="inp"
              type="tel"
              value={clientPhone}
              onChange={e => setClientPhone(e.target.value)}
              placeholder="05X-XXXXXXX"
              autoComplete="tel"
              style={{ direction: 'ltr', textAlign: 'right' }}
            />
          </div>
          <div className="field">
            <label>שירות</label>
            {svcs.length > 0 ? (
              <select className="inp" value={selService} onChange={e => setSelService(e.target.value)}>
                <option value="">בחר שירות...</option>
                {svcs.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input
                className="inp"
                value={selService}
                onChange={e => setSelService(e.target.value)}
                placeholder="תספורת, צביע, פן..."
              />
            )}
          </div>
          <div className="field">
            <label>הערה (אופציונלי)</label>
            <input
              className="inp"
              value={clientNote}
              onChange={e => setClientNote(e.target.value)}
              placeholder="בקשות מיוחדות..."
            />
          </div>

          <button
            className="btn-submit"
            style={{ background: col, opacity: valid && !submitting ? 1 : 0.5 }}
            disabled={!valid || submitting}
            onClick={submit}
          >
            {submitting ? 'שומר...' : '✓ קבע תור'}
          </button>
        </div>
      </div>
    )
  }

  // ── Step 5: Success ──────────────────────────────────────────
  if (step === 5) {
    return (
      <div className="wrap">
        <div className="success-wrap">
          <div className="success-icon">✓</div>
          <div className="success-title">הבקשה התקבלה!</div>
          <div className="success-sub">ניצור איתך קשר בקרוב לאישור התור</div>

          {bookingRef && (
            <div className="success-details">
              <div className="sdet"><span>📅 תאריך</span><span>{bookingRef.date}</span></div>
              <div className="sdet"><span>🕐 שעה</span><span>{bookingRef.time}</span></div>
              <div className="sdet"><span>💇 מטפל/ת</span><span>{bookingRef.prov}</span></div>
              {bookingRef.service && <div className="sdet"><span>✂ שירות</span><span>{bookingRef.service}</span></div>}
            </div>
          )}

          <button
            className="btn-outline"
            onClick={() => {
              setStep(1); setSelDate(''); setSelProv(null); setSelTime('')
              setSelService(''); setClientName(''); setClientPhone(''); setClientNote('')
            }}
          >+ קבע תור נוסף</button>
        </div>
      </div>
    )
  }

  return null
}
