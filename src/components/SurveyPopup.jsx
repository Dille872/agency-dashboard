import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'

export default function SurveyPopup({ session, displayName, userRole }) {
  const [surveys, setSurveys] = useState([])
  const [current, setCurrent] = useState(0)
  const [answer, setAnswer] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (displayName) loadPendingSurveys()
  }, [displayName])

  const loadPendingSurveys = async () => {
    const { data: allSurveys } = await supabase.from('surveys').select('*').eq('active', true).order('created_at')
    if (!allSurveys || allSurveys.length === 0) return

    const { data: responses } = await supabase.from('survey_responses').select('survey_id').eq('responder_name', displayName)
    const answeredIds = new Set((responses || []).map(r => r.survey_id))

    const pending = allSurveys.filter(s => {
      if (answeredIds.has(s.id)) return false
      if (s.target_roles?.length > 0 && !s.target_roles.includes(userRole)) return false
      if (s.target_names?.length > 0 && !s.target_names.includes(displayName)) return false
      return true
    })

    if (pending.length > 0) {
      setSurveys(pending)
      setVisible(true)
    }
  }

  const submit = async () => {
    if (!answer && surveys[current]?.answer_type !== 'text') return
    setSubmitting(true)
    await supabase.from('survey_responses').insert({
      survey_id: surveys[current].id,
      responder_name: displayName,
      responder_role: userRole,
      answer: answer || '',
      comment: comment || null,
    })
    setAnswer(''); setComment('')
    if (current + 1 < surveys.length) {
      setCurrent(c => c + 1)
    } else {
      setVisible(false)
    }
    setSubmitting(false)
  }

  const dismiss = () => setVisible(false)

  if (!visible || surveys.length === 0) return null

  const survey = surveys[current]
  const options = survey.options || []
  const remaining = surveys.length - current - 1

  const overlayS = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }
  const cardS = { background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 14, padding: '28px 32px', width: '100%', maxWidth: 440 }
  const optionS = (selected) => ({ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: `${selected ? '2px solid #7c3aed' : '1px solid #2e2e5a'}`, borderRadius: 8, cursor: 'pointer', background: selected ? 'rgba(124,58,237,0.06)' : 'var(--bg-card2)', marginBottom: 8 })

  return (
    <div style={overlayS} onClick={e => e.target === e.currentTarget && dismiss()}>
      <div style={cardS}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#7c3aed' }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
              Frage von {survey.created_by || 'Admin'}
            </span>
          </div>
          <button onClick={dismiss} style={{ fontSize: 11, color: 'var(--text-muted)', background: 'transparent', border: '1px solid #2e2e5a', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
            Später
          </button>
        </div>

        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '16px 0 20px', lineHeight: 1.4 }}>
          {survey.question}
        </div>

        {survey.answer_type === 'choice' && options.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {options.map((opt, i) => (
              <div key={i} style={optionS(answer === opt)} onClick={() => setAnswer(opt)}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${answer === opt ? '#7c3aed' : '#2e2e5a'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {answer === opt && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#7c3aed' }} />}
                </div>
                <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{opt}</span>
              </div>
            ))}
          </div>
        )}

        {survey.answer_type === 'scale' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginBottom: 6 }}>
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => setAnswer(String(n))} style={{
                  flex: 1, padding: '12px 0', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 16,
                  background: answer === String(n) ? '#7c3aed' : 'var(--bg-card2)',
                  color: answer === String(n) ? '#fff' : 'var(--text-muted)',
                  border: `1px solid ${answer === String(n) ? '#7c3aed' : '#2e2e5a'}`,
                }}>{n}</button>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)' }}>
              <span>Schlecht</span><span>Super</span>
            </div>
          </div>
        )}

        {(survey.answer_type === 'text' || (survey.answer_type === 'choice' && answer)) && (
          <textarea value={survey.answer_type === 'text' ? answer : comment}
            onChange={e => survey.answer_type === 'text' ? setAnswer(e.target.value) : setComment(e.target.value)}
            placeholder={survey.answer_type === 'text' ? 'Deine Antwort...' : 'Kommentar (optional)...'}
            rows={3}
            style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid #2e2e5a', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: 8, fontSize: 13, resize: 'none', fontFamily: 'inherit', outline: 'none', marginBottom: 16 }}
          />
        )}

        <button onClick={submit} disabled={submitting || (!answer && survey.answer_type !== 'text') || (survey.answer_type === 'text' && !answer.trim())}
          style={{ width: '100%', padding: 11, background: answer || survey.answer_type === 'text' ? '#7c3aed' : 'var(--border)', color: answer || survey.answer_type === 'text' ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          {submitting ? '...' : 'Antworten'}
        </button>

        {remaining > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 10 }}>
            Noch {remaining} weitere offene {remaining === 1 ? 'Frage' : 'Fragen'}
          </div>
        )}
      </div>
    </div>
  )
}
