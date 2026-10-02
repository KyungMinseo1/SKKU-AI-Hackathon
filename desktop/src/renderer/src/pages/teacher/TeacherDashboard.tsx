import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { api, errorMessage } from '../../api/client'
import type { CourseOut, CourseSummary } from '../../api/types'
import AppHeader from '../../components/AppHeader'
import { btnPrimary, btnSecondary, card, errorText, input } from '../../lib/ui'

function NewCourseModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [semester, setSemester] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const course = await api<CourseOut>('/api/courses', {
        json: { name: name.trim(), code: code.trim() || null, semester: semester.trim() || null }
      })
      navigate(`/teacher/courses/${course.id}`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className={`${card} w-full max-w-md space-y-3 p-6`}
      >
        <h2 className="text-lg font-semibold">새 강의</h2>
        <label className="block space-y-1">
          <span className="text-sm text-gray-700">강의명 *</span>
          <input
            className={input}
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-gray-700">학수번호</span>
          <input className={input} value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-gray-700">학기</span>
          <input
            className={input}
            placeholder="예: 2026-2"
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
          />
        </label>
        {error && <p className={errorText}>{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            취소
          </button>
          <button type="submit" className={btnPrimary} disabled={busy || !name.trim()}>
            만들기
          </button>
        </div>
      </form>
    </div>
  )
}

export default function TeacherDashboard(): React.JSX.Element {
  const navigate = useNavigate()
  const [courses, setCourses] = useState<CourseSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    api<CourseSummary[]>('/api/courses')
      .then(setCourses)
      .catch((err) => setError(errorMessage(err)))
  }, [])

  return (
    <div className="flex min-h-full flex-col bg-gray-50">
      <AppHeader
        actions={
          <button className={btnPrimary} onClick={() => setShowNew(true)}>
            + 새 강의
          </button>
        }
      >
        <h1 className="text-lg font-bold text-indigo-700">ASKKUP</h1>
        <span className="text-gray-500">내 강의</span>
      </AppHeader>
      <main className="flex-1 p-6">
        {error && <p className={errorText}>{error}</p>}
        {courses === null && !error && <p className="text-gray-500">불러오는 중…</p>}
        {courses?.length === 0 && (
          <p className="text-gray-500">
            아직 강의가 없습니다. &quot;새 강의&quot;로 시작해 보세요.
          </p>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {courses?.map((c) => (
            <button
              key={c.id}
              className={`${card} text-left transition hover:border-indigo-300 hover:shadow-md`}
              onClick={() => navigate(`/teacher/courses/${c.id}`)}
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold">{c.name}</h2>
                {c.open_session && (
                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    수업 중
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {[c.code, c.semester].filter(Boolean).join(' · ') || '\u00a0'}
              </p>
              <p className="mt-3 text-sm text-gray-700">
                주차 {c.week_count}개 · 질문 {c.question_count}개
              </p>
            </button>
          ))}
        </div>
      </main>
      {showNew && <NewCourseModal onClose={() => setShowNew(false)} />}
    </div>
  )
}
