# ASKKUP (질문, 잇다)

수업 중 생긴 학생 질문을 AI가 다듬어 교사에게 **익명으로** 전달하는 학습 지원 앱입니다.

- **학생**: 수업 코드로 참여 → 화면 위 투명 오버레이에 펜으로 표시하거나 질문을 대충 입력 → AI가 다듬은 질문을 확인("이 의미가 맞나요?") 후 등록 → 내 질문을 주제별·유형별 마인드맵으로 확인
- **교사**: 강의계획서(PDF)·교안(PDF/PPTX) 업로드 → 주차별 개념 맵 자동 생성·편집 → 수업 열기(6자리 코드) → 실시간으로 개념별·유형별 질문 맵과 시간순 대화창 확인

상세 설계는 [docs/PLAN.md](docs/PLAN.md)를 참고하세요.

## 구조

```
server/   Python FastAPI 서버 + SQLite + AI 연동, pytest 테스트
desktop/  Electron 앱 (electron-vite, React, TypeScript, Tailwind) — 학생/교사 공용
docs/     설계 문서, 데모 강의계획서
```

## 사전 준비

| 도구 | 버전 | 용도 |
| --- | --- | --- |
| [uv](https://docs.astral.sh/uv/) | 0.11+ | 서버 가상환경·의존성 관리 |
| Python | 3.11 | 서버 (`uv`가 없으면 자동 설치) |
| Node.js / npm | 22 / 10 | 데스크톱 앱 |

uv 설치(택 1):

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
# 또는
pip install uv
```

## 1. 서버 가상환경 만들기

```bash
cd server
uv sync
```

`uv sync`가 `server/.venv` 가상환경을 만들고 `pyproject.toml`/`uv.lock` 기준으로 의존성(개발용 pytest 포함)을 설치합니다. Python 3.11(`server/.python-version`)이 없으면 uv가 내려받습니다.

이후 명령은 `uv run <명령>`으로 실행하면 가상환경을 자동으로 사용합니다. 직접 활성화하려면:

```powershell
# PowerShell
server\.venv\Scripts\Activate.ps1
# Git Bash
source server/.venv/Scripts/activate
```

## 2. 데스크톱 의존성 설치

```bash
cd desktop
npm install
```

## 3. 환경 변수 설정

### 서버 — `server/.env` (AI API 키)

```bash
cd server
cp .env.example .env
```

서버는 **실행한 폴더의 `.env`** 를 읽으므로 반드시 `server/` 안에 두고, 서버도 `server/`에서 실행합니다. `.env`는 서버 시작 시에만 읽으므로 수정 후 서버를 재시작하세요.

AI 역할은 세 가지로 나뉘며 각각 다른 제공자를 쓸 수 있습니다.

| 역할 | 용도 |
| --- | --- |
| `QUESTION_LLM_*` | 학생 질문 다듬기·부적절 표현 판정 (이미지 입력) |
| `CURRICULUM_LLM_*` | 강의계획서 분석, 주차 개념 생성(웹 검색), 질문 분류 |
| `EMBEDDING_*` | 질문-개념 유사도 후보 계산 (`none`이면 LLM만으로 분류) |

`*_API_KEY`를 비워 두면 제공자별 공통 키(`OPENAI_API_KEY` / `GEMINI_API_KEY`)를 사용합니다. `*_BASE_URL`은 vLLM일 때만 필요합니다.

**OpenAI** (기본값)

```env
JWT_SECRET=32자-이상의-임의-문자열
OPENAI_API_KEY=sk-...
QUESTION_LLM_PROVIDER=openai
QUESTION_LLM_MODEL=gpt-6-luna
CURRICULUM_LLM_PROVIDER=openai
CURRICULUM_LLM_MODEL=gpt-6-luna
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
```

**Gemini**

```env
JWT_SECRET=32자-이상의-임의-문자열
GEMINI_API_KEY=AIza...
QUESTION_LLM_PROVIDER=gemini
QUESTION_LLM_MODEL=gemini-3.8-flash
CURRICULUM_LLM_PROVIDER=gemini
CURRICULUM_LLM_MODEL=gemini-3.8-flash
EMBEDDING_PROVIDER=gemini
EMBEDDING_MODEL=gemini-embedding-001
```

**vLLM** (OpenAI 호환 서버)

```env
QUESTION_LLM_PROVIDER=vllm
QUESTION_LLM_BASE_URL=http://localhost:8001/v1
QUESTION_LLM_MODEL=Qwen/Qwen2.5-VL-7B-Instruct
CURRICULUM_LLM_PROVIDER=vllm
CURRICULUM_LLM_BASE_URL=http://localhost:8001/v1
CURRICULUM_LLM_MODEL=Qwen/Qwen2.5-VL-7B-Instruct
EMBEDDING_PROVIDER=vllm
EMBEDDING_BASE_URL=http://localhost:8002/v1
EMBEDDING_MODEL=BAAI/bge-m3
```

참고:

- 모델 이름은 본인 계정에서 사용 가능한 것으로 바꾸세요(예: OpenAI `gpt-5.4-mini`).
- `reasoning_effort` 관련 오류가 나면 `QUESTION_LLM_REASONING_EFFORT=`를 비우세요(빈 값이면 전송하지 않음).
- 비전을 지원하지 않는 모델이면 `QUESTION_LLM_SUPPORTS_IMAGES=false`.
- 웹 검색: OpenAI는 `web_search` 도구, Gemini는 Google 검색, vLLM은 DuckDuckGo를 사용합니다.

연결 확인(선택, `server/`에서):

```bash
uv run python -c "import asyncio; from app.config import Settings; from app.ai.llm import build_ai_clients; from app.ai.structured import RefineResult; c=build_ai_clients(Settings()); print(asyncio.run(c.question.json('질문을 다듬어라','회귀 분류 차이?',RefineResult))); print(len(asyncio.run(c.embedder.embed(['회귀']))[0]))"
```

다듬은 질문과 임베딩 차원 숫자가 출력되면 정상입니다.

### 데스크톱 — `desktop/.env` (선택, 서버 주소)

앱의 기본 서버 주소는 `http://localhost:8000`입니다. 다른 포트·PC를 쓰면:

```env
VITE_API_BASE_URL=http://localhost:1111
```

빌드 시점에 반영되므로 수정 후 `npm run dev`를 재시작하거나 `npm run build`를 다시 하세요. 로그인 화면의 "서버 주소"에서 바꿔도 됩니다(로그인 버튼을 눌러야 저장되며 프로필별로 기억됩니다. 이미 저장된 주소가 있으면 `.env`보다 우선합니다).

## 4. 실행

터미널 3개를 사용합니다.

**① 서버**

```bash
cd server
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

포트를 바꾸면 `--port`와 앱의 서버 주소를 함께 맞추세요. DB·업로드 파일은 `server/data/`에 자동 생성됩니다.

**② 교사 앱**

```bash
cd desktop
npm run dev
```

**③ 학생 앱** — 한 PC에서 교사·학생을 동시에 쓰려면 로그인 정보가 섞이지 않도록 프로필을 분리한 빌드본으로 실행합니다.

```bash
cd desktop
npm run build
npx electron . --profile=student
```

다른 PC의 학생은 서버 주소를 `http://<서버 PC IP>:<포트>`로 설정하세요(서버 PC 방화벽에서 포트 허용 필요).

## 5. 사용 흐름

1. **교사**: 회원가입 시 역할을 **교사**로 선택(기본값은 학생) → 강의 생성 → 강의계획서 PDF 업로드(데모: `docs/인공지능개론/노해선_인공지능개론01_강의계획서_16주차.pdf`) → 주차 탭·개념 맵 자동 생성
2. **교사**(선택): 주차별 교안(PDF/PPTX) 업로드, 개념 편집, 금지어 추가
3. **교사**: `수업 열기` → 주차 선택 → 6자리 수업 코드 표시
4. **학생**: 회원가입(학생) → 수업 코드 입력 → 투명 오버레이 표시(다른 앱 클릭은 그대로 통과)
5. **학생**: 펜으로 화면 표시(선택) + 질문 입력 → `질문 다듬기` → `예, 등록할게요` (`아니요`면 수정 요청 후 재작성)
6. **교사**: 라이브 화면에서 개념별/유형별 맵과 대화창에 질문이 실시간 표시 (학생 신원은 표시되지 않음)
7. **학생**: 툴바의 `대시보드`에서 내 질문을 주제별·유형별로 확인

## 6. 테스트·검사

```bash
cd server && uv run pytest -q        # 서버 테스트 (가짜 AI 사용, API 키 불필요)
cd desktop && npm run typecheck      # 타입 검사
cd desktop && npm run lint           # 린트
```

## 문제 해결

- **"이미 가입된 이메일입니다"인데 DB에서 지웠다**: DB는 WAL 모드라 최근 변경이 `askkup.db-wal`에 있습니다. GUI 도구에서 지웠다면 저장(커밋)했는지, `-wal`을 무시하는 뷰어가 아닌지 확인하세요. 확실하게 지우려면:
  ```bash
  cd server
  uv run python -c "import sqlite3; c=sqlite3.connect('data/askkup.db'); c.execute('PRAGMA foreign_keys=ON'); c.execute(\"delete from users where email='삭제할@이메일'\"); c.commit()"
  ```
- **데이터 전체 초기화**: 서버를 끄고 `server/data/` 폴더를 삭제한 뒤 서버를 다시 실행합니다(업로드 파일 포함 전부 삭제).
- **실라버스 분석/주차 생성 실패**: API 키·모델 이름을 확인하고 서버 재시작 후 실라버스를 다시 업로드하거나 주차의 `다시 생성`을 누르세요. 원인은 서버 터미널 로그에 표시됩니다.
- **포트 사용 권한 오류(Windows)**: `netsh interface ipv4 show excludedportrange protocol=tcp`로 예약된 포트인지 확인하고 다른 포트를 사용하세요.
