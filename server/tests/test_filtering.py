import pytest

from app.services.filtering import find_banned


@pytest.mark.parametrize("text", ["시 발", "씨.발", "ㅅㅂ"])
def test_find_banned_hits(text):
    assert find_banned(text, []) is not None


@pytest.mark.parametrize("text", ["새끼손가락", "미친 듯이", "시발점"])
def test_find_banned_misses(text):
    assert find_banned(text, []) is None


async def test_course_banned_words_and_llm_block(client, api):
    teacher = await api.signup("teacher", "teacher@example.com")
    student = await api.signup("student", "student@example.com")
    r = await client.post("/api/courses", json={"name": "인공지능개론"}, headers=teacher)
    course_id = r.json()["id"]
    r = await client.post(f"/api/courses/{course_id}/weeks", json={"title": "지도학습"}, headers=teacher)
    assert r.status_code == 201
    week_id = r.json()["id"]

    r = await client.post(f"/api/courses/{course_id}/banned-words", json={"word": " 바 보 "}, headers=teacher)
    assert r.status_code == 201 and r.json()["word"] == "바보"
    r = await client.post(f"/api/courses/{course_id}/banned-words", json={"word": "바보"}, headers=teacher)
    assert r.status_code == 409

    session = await api.open_session(teacher, course_id, week_id)
    calls_before = client.fake_question.calls
    blocked = await api.refine(student, session["id"], "바보 같은 질문")
    assert blocked["status"] == "blocked"
    assert "바보" in blocked["reason"]
    assert client.fake_question.calls == calls_before

    lunch = await api.refine(student, session["id"], "점심 뭐 먹지")
    assert lunch["status"] == "blocked"
    assert client.fake_question.calls == calls_before + 1

    r = await api.submit(student, session["id"], "x", "바보 같은 질문인가요?")
    assert r.status_code == 400
    assert r.json()["detail"] == "부적절한 표현이 포함되어 있습니다"
