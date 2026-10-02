from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.models import ClassSession, Course
from app.security import user_from_token

router = APIRouter()


@router.websocket("/ws/sessions/{session_id}")
async def live_session(websocket: WebSocket, session_id: int, token: str | None = None) -> None:
    ctx = websocket.app.state.ctx
    async with ctx.sessionmaker() as db:
        user = await user_from_token(db, token)
        session = await db.get(ClassSession, session_id)
        course = await db.get(Course, session.course_id) if session else None
        allowed = user is not None and user.role == "teacher" and course is not None and course.teacher_id == user.id
    await websocket.accept()
    if not allowed:
        await websocket.close(code=4403)
        return
    ctx.hub.subscribe(session_id, websocket)
    try:
        while True:
            await websocket.receive_text()  # 클라이언트 ping 무시
    except WebSocketDisconnect:
        pass
    finally:
        ctx.hub.unsubscribe(session_id, websocket)
