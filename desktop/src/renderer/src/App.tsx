import { Navigate, Outlet, Route, Routes } from 'react-router'
import type { Role } from './api/types'
import { roleHome, useAuth } from './stores/auth'
import LoginPage from './pages/auth/LoginPage'
import SignupPage from './pages/auth/SignupPage'
import TeacherDashboard from './pages/teacher/TeacherDashboard'
import CoursePage from './pages/teacher/CoursePage'
import LiveSessionPage from './pages/teacher/LiveSessionPage'
import StudentDashboard from './pages/student/StudentDashboard'
import OverlayPage from './pages/student/OverlayPage'

/** No token → /login; wrong role → that role's home. */
function RequireRole({ role }: { role: Role }): React.JSX.Element {
  const token = useAuth((s) => s.token)
  const user = useAuth((s) => s.user)
  if (!token || !user) return <Navigate to="/login" replace />
  if (user.role !== role) return <Navigate to={roleHome(user.role)} replace />
  return <Outlet />
}

function HomeRedirect(): React.JSX.Element {
  const user = useAuth((s) => s.user)
  const token = useAuth((s) => s.token)
  return <Navigate to={token && user ? roleHome(user.role) : '/login'} replace />
}

export default function App(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route element={<RequireRole role="teacher" />}>
        <Route path="/teacher" element={<TeacherDashboard />} />
        <Route path="/teacher/courses/:courseId" element={<CoursePage />} />
        <Route path="/teacher/sessions/:sessionId/live" element={<LiveSessionPage />} />
      </Route>
      <Route element={<RequireRole role="student" />}>
        <Route path="/student" element={<StudentDashboard />} />
        <Route path="/overlay" element={<OverlayPage />} />
      </Route>
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  )
}
