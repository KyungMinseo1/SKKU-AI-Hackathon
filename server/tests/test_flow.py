import re


async def test_full_flow(client, api):
    teacher = await api.signup("teacher", "teacher@example.com")
    student = await api.signup("student", "student@example.com")

    r = await client.post("/api/courses", json={"name": "x"}, headers=student)
    assert r.status_code == 403
    assert r.json()["detail"] == "권한이 없습니다"

    course_id = await api.course_with_syllabus(teacher)
    graph = await api.graph(teacher, course_id)
    assert graph["course"]["syllabus_status"] == "done"
    weeks = {w["week_no"]: w for w in graph["weeks"]}
    assert set(weeks) == {3, 9}

    w3, w9 = weeks[3], weeks[9]
    assert w3["gen_status"] == "done" and w3["gen_source"] == "web"
    assert any(n["source"] == "web" for n in w3["nodes"])
    assert {n["title"] for n in w3["nodes"] if n["source"] == "syllabus"} == {
        "머신러닝의 유형(1) 지도학습",
        "지도학습의 대표적 문제: 회귀와 분류",
    }
    assert w9["is_lecture"] is False
    assert w9["gen_status"] == "idle"
    assert not [n for n in w9["nodes"] if n["source"] in ("material", "web", "llm")]

    session = await api.open_session(teacher, course_id, w3["id"])
    assert re.fullmatch(r"[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}", session["code"])
    assert session["status"] == "open" and session["week_no"] == 3

    # 이미 열린 수업이 있으면 그것을 200으로 반환
    r = await client.post(f"/api/courses/{course_id}/sessions", json={"week_id": w3["id"]}, headers=teacher)
    assert r.status_code == 200 and r.json()["id"] == session["id"]

    r = await client.post("/api/sessions/join", json={"code": f"  {session['code'].lower()} "}, headers=student)
    assert r.status_code == 200, r.text
    assert r.json()["id"] == session["id"]

    refined = await api.refine(student, session["id"], "회귀 분류 차이?")
    assert refined["status"] == "ok"
    assert refined["refined_text"] == "회귀 분류 차이?에 대해 설명해 주실 수 있나요?"

    r = await api.submit(student, session["id"], "회귀 분류 차이?", refined["refined_text"])
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "pending"
    await api.drain()

    r = await client.get("/api/me/questions", headers=student)
    mine = r.json()
    assert len(mine) == 1
    assert mine[0]["status"] == "classified"
    assert mine[0]["concept_path"]
    assert mine[0]["question_type"] == "info_seeking"
    assert mine[0]["keyword"] == "회귀"
    assert mine[0]["assigned_week"]["id"] == w3["id"] and mine[0]["off_week"] is False
    assert mine[0]["created_at"].endswith("Z")

    r = await client.get(f"/api/sessions/{session['id']}/questions", headers=teacher)
    assert r.status_code == 200
    teacher_qs = r.json()
    assert len(teacher_qs) == 1
    for key in ("student_id", "raw_text", "name", "email"):
        assert key not in teacher_qs[0]
    assert teacher_qs[0]["concept_path"] == mine[0]["concept_path"]

    r = await client.post(f"/api/sessions/{session['id']}/close", headers=teacher)
    assert r.status_code == 200 and r.json()["status"] == "closed"

    r = await api.submit(student, session["id"], "또 질문", "또 질문이 있어요?")
    assert r.status_code == 409
    assert r.json()["detail"] == "수업이 종료되어 질문을 등록할 수 없습니다"
