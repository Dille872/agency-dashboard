import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'

/**
 * SurveyModal - zeigt offene Umfragen als Popup im Chatter/Model-Portal.
 * Lädt alle aktiven Umfragen wo:
 *   - der eingeloggte User in survey_recipients steht
 *   - er noch nicht alle Pflichtfragen beantwortet hat
 * Zeigt eine Umfrage nach der anderen. "Später" → Modal weg, kommt beim nächsten Login.
 *
 * Props:
 *   displayName: string (Name des eingeloggten Users)
 *   role: 'chatter' | 'model'
 */
export default function SurveyModal({ displayName, role }) {
  const [pending, setPending] = useState([]) // [{survey, questions:[...]}]
  const [currentIdx, setCurrentIdx] = useState(0)
  const [answers, setAnswers] = useState({}) // { questionId: { answer, comment } }
  const [submitting, setSubmitting] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!displayName) { setLoading(false); return }
    loadPending()
  }, [displayName])

  const loadPending = async () => {
    setLoading(true)
    // 1. Alle aktiven Umfragen wo dieser User Empfänger ist
    const { data: recipientRows } = await supabase
      .from('survey_recipients')
      .select('survey_id')
      .eq('recipient_name', displayName)
      .eq('recipient_role', role)

    const surveyIds = (recipientRows || []).map(r => r.survey_id)
    if (surveyIds.length === 0) { setPending([]); setLoading(false); return }

    const { data: surveys } = await supabase
      .from('surveys')
      .select('*')
      .in('id', surveyIds)
      .eq('active', true)
      .order('created_at', { ascending: true })

    if (!surveys || surveys.length === 0) { setPending([]); setLoading(false); return }

    // 2. Fragen + bereits gegebene Antworten laden
    const allSurveyIds = surveys.map(s => s.id)
    const { data: questions } = await supabase
      .from('survey_questions')
      .select('*')
      .in('survey_id', allSurveyIds)
      .order('position', { ascending: true })

    const { data: myResponses } = await supabase
      .from('survey_responses')
      .select('survey_id, question_id')
      .in('survey_id', allSurveyIds)
      .eq('responder_name', displayName)

    const answeredSet = new Set((myResponses || []).map(r => `${r.survey_id}:${r.question_id}`))

    // 3. Filtern: nur Umfragen wo noch nicht alle Fragen beantwortet sind
    const stillPending = []
    for (const s of surveys) {
      const qs = (questions || []).filter(q => q.survey_id === s.id)
      if (qs.length === 0) continue
      const allAnswered = qs.every(q => answeredSet.has(`${s.id}:${q.id}`))
      if (!allAnswered) {
        // v3.80.0: bereits beantwortete Fragen-IDs merken, damit beim Absenden
        // nur NEUE Antworten eingefügt werden (sonst kippt der Unique-Konflikt den
        // ganzen Insert und die neuen Antworten gehen verloren).
        const answeredIds = new Set(qs.filter(q => answeredSet.has(`${s.id}:${q.id}`)).map(q => q.id))
        stillPending.push({ survey: s, questions: qs, answeredIds })
      }
    }

    setPending(stillPending)
    setCurrentIdx(0)
    setAnswers({})
    setLoading(false)
  }

  if (loading || dismissed || pending.length === 0) return null
  if (currentIdx >= pending.length) return null

  const { survey, questions } = pending[currentIdx]

  const setAnswer = (qId, val) => {
    setAnswers(prev => ({ ...prev, [qId]: { ...(prev[qId] || {}), answer: val } }))
  }
  const setComment = (qId, val) => {
    setAnswers(prev => ({ ...prev, [qId]: { ...(prev[qId] || {}), comment: val } }))
  }

  // Pflicht: choice/scale müssen beantwortet sein. text ist optional.
  const allRequiredAnswered = questions.every(q => {
    if (q.answer_type === 'text') return true
    const a = answers[q.id]?.answer
    return a !== undefined && a !== null && String(a).length > 0
  })

  const handleSubmit = async () => {
    if (submitting) return // Double-Click-Schutz
    setSubmitting(true)
    // v3.80.0: nur noch nicht beantwortete Fragen einfügen
    const answeredIds = pending[currentIdx].answeredIds || new Set()
    const rows = questions
      .filter(q => !answeredIds.has(q.id))
      .map(q => ({
        survey_id: survey.id,
        question_id: q.id,
        responder_name: displayName,
        responder_role: role,
        answer: String(answers[q.id]?.answer ?? ''),
        comment: answers[q.id]?.comment || null,
      }))

    if (rows.length > 0) {
      const { error } = await supabase.from('survey_responses').insert(rows)
      if (error) {
        // Falls Doppel-Insert: nicht als Fehler behandeln (User hat schon geantwortet)
        const isDuplicate = error.code === '23505' || /duplicate|unique/i.test(error.message || '')
        if (!isDuplicate) {
          alert('Fehler beim Speichern: ' + error.message + '\nBitte erneut versuchen.')
          setSubmitting(false)
          return
        }
      }
    }

    // Nächste Umfrage oder fertig
    if (currentIdx + 1 < pending.length) {
      setCurrentIdx(currentIdx + 1)
      setAnswers({})
      setSubmitting(false)
    } else {
      setSubmitting(false)
      setDismissed(true)
    }
  }

  const handleLater = () => setDismissed(true)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: 20, maxWidth: 480, width: '100%',
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
            background: 'rgba(124,58,237,0.18)', color: '#a78bfa',
          }}>
            NEUE UMFRAGE
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {questions.length} Frage{questions.length !== 1 ? 'n' : ''}
            {pending.length > 1 && ` · ${currentIdx + 1}/${pending.length}`}
          </span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '6px 0 14px' }}>
          {survey.title || survey.question || 'Umfrage'}
        </div>

        {/* Fragen */}
        {questions.map((q, idx) => {
          const a = answers[q.id]?.answer
          return (
            <div key={q.id} style={{
              borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 12,
            }}>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>{idx + 1}.</span>
                {q.question}
                {q.answer_type !== 'text' && <span style={{ color: '#ef4444', marginLeft: 4 }}>*</span>}
              </div>

              {q.answer_type === 'choice' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 6 }}>
                  {(q.options || []).map((opt, i) => {
                    const active = a === opt
                    return (
                      <button key={i} onClick={() => setAnswer(q.id, opt)} style={{
                        padding: '7px 8px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                        fontWeight: 600, fontSize: 12,
                        background: active ? '#7c3aed22' : 'transparent',
                        color: active ? '#a78bfa' : 'var(--text-secondary)',
                        border: `1px solid ${active ? '#7c3aed' : 'var(--border)'}`,
                      }}>{opt}</button>
                    )
                  })}
                </div>
              )}

              {q.answer_type === 'scale' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 3, 4, 5].map(n => {
                    const active = String(a) === String(n)
                    return (
                      <button key={n} onClick={() => setAnswer(q.id, n)} style={{
                        flex: 1, padding: '8px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                        fontWeight: 700, fontSize: 13,
                        background: active ? '#7c3aed22' : 'transparent',
                        color: active ? '#a78bfa' : 'var(--text-secondary)',
                        border: `1px solid ${active ? '#7c3aed' : 'var(--border)'}`,
                      }}>{n}</button>
                    )
                  })}
                </div>
              )}

              {q.answer_type === 'text' && (
                <textarea
                  value={a || ''}
                  onChange={e => setAnswer(q.id, e.target.value)}
                  placeholder="Optional…"
                  style={{
                    width: '100%', minHeight: 56, padding: 9, borderRadius: 7,
                    background: 'var(--bg-input)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit',
                    resize: 'vertical', boxSizing: 'border-box', outline: 'none',
                  }}
                />
              )}

              {q.answer_type !== 'text' && a !== undefined && (
                <input
                  value={answers[q.id]?.comment || ''}
                  onChange={e => setComment(q.id, e.target.value)}
                  placeholder="Kommentar (optional)…"
                  style={{
                    width: '100%', marginTop: 6, padding: '6px 9px', borderRadius: 6,
                    background: 'var(--bg-input)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', fontSize: 11, fontFamily: 'inherit',
                    boxSizing: 'border-box', outline: 'none',
                  }}
                />
              )}
            </div>
          )
        })}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={handleLater} disabled={submitting} style={{
            flex: 1, padding: '9px', borderRadius: 7, cursor: submitting ? 'not-allowed' : 'pointer',
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-muted)', fontSize: 13, fontFamily: 'inherit', fontWeight: 600,
          }}>Später</button>
          <button onClick={handleSubmit} disabled={submitting || !allRequiredAnswered} style={{
            flex: 2, padding: '9px', borderRadius: 7,
            cursor: (submitting || !allRequiredAnswered) ? 'not-allowed' : 'pointer',
            background: allRequiredAnswered ? '#7c3aed' : 'var(--border)',
            color: allRequiredAnswered ? '#fff' : 'var(--text-muted)',
            border: 'none', fontSize: 13, fontFamily: 'inherit', fontWeight: 700,
          }}>
            {submitting ? '…' : 'Absenden'}
          </button>
        </div>
      </div>
    </div>
  )
}
