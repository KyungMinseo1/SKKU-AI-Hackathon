from datetime import timedelta

from app.models import StudentQuestion


async def _setup(client, api):
    teacher = await api.signup("teacher", "t@example.com")
    student = await api.signup("student", "s@example.com")
    course_id = await api.course_with_syllabus(teacher)
    graph = await api.graph(teacher, course_id)
    w3 = next(w for w in graph["weeks"] if w["week_no"] == 3)
    session = await api.open_session(teacher, course_id, w3["id"])
    r = await client.post("/api/sessions/join", json={"code": session["code"]}, headers=student)
    assert r.status_code == 200, r.text
    return teacher, student, course_id, graph, session


async def test_session_history_and_reopen(client, api):
    teacher, student, course_id, graph, session = await _setup(client, api)
    r = await api.submit(student, session["id"], "회귀?", "회귀가 뭔가요?")
    assert r.status_code == 201
    await api.drain()
    await client.post(f"/api/sessions/{session['id']}/close", headers=teacher)

    r = await client.get(f"/api/courses/{course_id}/sessions", headers=teacher)
    assert r.status_code == 200
    [s] = r.json()
    assert s["status"] == "closed" and s["question_count"] == 1

    # 종료 후에도 교사는 질문을 볼 수 있다
    r = await client.get(f"/api/sessions/{session['id']}/questions", headers=teacher)
    assert len(r.json()) == 1

    r = await client.get("/api/me/sessions", headers=student)
    assert [x["id"] for x in r.json()] == [session["id"]]

    r = await client.post(f"/api/sessions/{session['id']}/reopen", headers=teacher)
    assert r.status_code == 200 and r.json()["status"] == "open" and r.json()["closed_at"] is None
    r = await client.post("/api/sessions/join", json={"code": r.json()["code"]}, headers=student)
    assert r.status_code == 200

    # 다른 수업이 열려 있으면 재개 불가
    await client.post(f"/api/sessions/{session['id']}/close", headers=teacher)
    w9 = next(w for w in graph["weeks"] if w["week_no"] == 9)
    await api.open_session(teacher, course_id, w9["id"])
    r = await client.post(f"/api/sessions/{session['id']}/reopen", headers=teacher)
    assert r.status_code == 409
    assert r.json()["detail"] == "이미 진행 중인 수업이 있습니다. 먼저 종료해 주세요"


async def test_memo_and_recall(client, api):
    _, student, _, _, session = await _setup(client, api)
    r = await api.submit(student, session["id"], "회귀?", "회귀가 뭔가요?")
    qid = r.json()["id"]
    assert r.json()["memo"] == "" and r.json()["recall_answer"] is None

    r = await client.patch(f"/api/me/questions/{qid}/memo", json={"memo": "교재 3장"}, headers=student)
    assert r.status_code == 200 and r.json()["memo"] == "교재 3장"

    r = await client.post(f"/api/me/questions/{qid}/recall", json={"answer": "연속값 예측"}, headers=student)
    assert r.status_code == 409
    assert r.json()["detail"] == "아직 리콜 퀴즈를 풀 수 없습니다"

    async with client.ctx.sessionmaker() as db:
        q = await db.get(StudentQuestion, qid)
        q.created_at -= timedelta(hours=1)
        await db.commit()
    r = await client.post(f"/api/me/questions/{qid}/recall", json={"answer": "연속값 예측"}, headers=student)
    assert r.status_code == 200
    assert r.json()["recall_answer"] == "연속값 예측" and r.json()["recall_answered_at"].endswith("Z")

    other = await api.signup("student", "other@example.com")
    r = await client.patch(f"/api/me/questions/{qid}/memo", json={"memo": "x"}, headers=other)
    assert r.status_code == 404


async def test_move_teacher_question(client, api):
    teacher, student, course_id, graph, session = await _setup(client, api)
    await api.submit(student, session["id"], "회귀?", "회귀가 뭔가요?")
    await api.drain()
    [tq] = (await client.get(f"/api/courses/{course_id}/questions", headers=teacher)).json()
    w3 = next(w for w in graph["weeks"] if w["week_no"] == 3)
    w9 = next(w for w in graph["weeks"] if w["week_no"] == 9)
    target = next(n for n in w3["nodes"] if n["id"] != tq["concept_path"][-1]["id"])

    r = await client.patch(f"/api/teacher-questions/{tq['id']}", json={"concept_node_id": target["id"]}, headers=teacher)
    assert r.status_code == 200, r.text
    assert r.json()["concept_path"][-1]["id"] == target["id"]

    r = await client.patch(f"/api/teacher-questions/{tq['id']}", json={"week_id": w9["id"]}, headers=teacher)
    assert r.json()["assigned_week"]["id"] == w9["id"] and r.json()["off_week"] is True
    [mine] = (await client.get("/api/me/questions", headers=student)).json()
    assert mine["assigned_week"]["id"] == w9["id"] and mine["concept_path"] == []

    r = await client.patch(f"/api/teacher-questions/{tq['id']}", json={}, headers=teacher)
    assert r.status_code == 422
