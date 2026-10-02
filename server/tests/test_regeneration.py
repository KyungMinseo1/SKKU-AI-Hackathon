async def test_regeneration_preserves_edits_and_requeues_questions(client, api):
    teacher = await api.signup("teacher", "teacher@example.com")
    student = await api.signup("student", "student@example.com")
    course_id = await api.course_with_syllabus(teacher)

    graph = await api.graph(teacher, course_id)
    w3 = next(w for w in graph["weeks"] if w["week_no"] == 3)
    generated = sorted(
        (n for n in w3["nodes"] if n["source"] == "web" and n["parent_id"] is not None), key=lambda n: n["id"]
    )
    assert len(generated) == 2
    edited, untouched = generated

    r = await client.patch(f"/api/nodes/{edited['id']}", json={"title": "편집된 개념"}, headers=teacher)
    assert r.status_code == 200, r.text
    assert r.json()["edited"] is True

    session = await api.open_session(teacher, course_id, w3["id"])
    r = await client.post("/api/sessions/join", json={"code": session["code"]}, headers=student)
    assert r.status_code == 200
    refined = await api.refine(student, session["id"], "회귀 뭐임")
    r = await api.submit(student, session["id"], "회귀 뭐임", refined["refined_text"])
    assert r.status_code == 201
    await api.drain()

    mine = (await client.get("/api/me/questions", headers=student)).json()
    assert mine[0]["status"] == "classified"
    assert mine[0]["concept_path"][-1]["id"] == untouched["id"]

    r = await client.post(f"/api/weeks/{w3['id']}/regenerate", headers=teacher)
    assert r.status_code == 202, r.text
    await api.drain()

    graph = await api.graph(teacher, course_id)
    w3 = next(w for w in graph["weeks"] if w["week_no"] == 3)
    assert w3["gen_status"] == "done"
    by_id = {n["id"]: n for n in w3["nodes"]}
    assert by_id[edited["id"]]["title"] == "편집된 개념"
    assert by_id[edited["id"]]["edited"] is True
    assert untouched["id"] not in by_id
    assert len([n for n in w3["nodes"] if n["source"] == "syllabus"]) == 2
    new_concepts = [n for n in w3["nodes"] if n["source"] == "web" and not n["edited"]]
    assert len(new_concepts) == 2
    assert all(n["id"] > untouched["id"] for n in new_concepts)

    mine = (await client.get("/api/me/questions", headers=student)).json()
    assert mine[0]["status"] == "classified"
    assert mine[0]["concept_path"][-1]["id"] == max(n["id"] for n in new_concepts)

    tq = (await client.get(f"/api/sessions/{session['id']}/questions", headers=teacher)).json()
    assert tq[0]["concept_path"][-1]["id"] == max(n["id"] for n in new_concepts)
