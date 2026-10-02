# ASKKUP — macOS 실행 가이드

macOS(Apple Silicon / Intel)에서 ASKKUP 서버와 데스크톱 앱을 설치·실행하는 방법입니다. 공통 설명(구조, AI 역할, 사용 흐름)은 [README.md](README.md)를 참고하세요.

> 이 저장소는 Windows에서 개발·검증되었습니다. 아래 macOS 절차는 macOS 기준으로 정리한 것이며, 특히 화면 캡처 권한·전체 화면 앱 위 오버레이는 macOS 고유 제약이 있습니다([macOS 주의사항](#macos-주의사항)).

## 사전 준비

[Homebrew](https://brew.sh/)가 있다고 가정합니다.

```bash
brew install uv node@22
```

- `node@22`는 keg-only라 PATH 추가가 필요할 수 있습니다(설치 후 brew가 안내하는 `echo 'export PATH=...' >> ~/.zshrc`를 실행하고 터미널 재시작).
- Homebrew 없이 uv만 설치하려면: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- 확인: `uv --version`, `node -v`(v22.x), `npm -v`

Python 3.11은 따로 설치하지 않아도 됩니다. `uv`가 필요하면 자동으로 내려받습니다.

## 1. 서버 가상환경 만들기

```bash
cd server
uv sync
```

`server/.venv` 가상환경이 생성되고 `uv.lock` 기준으로 의존성(pytest 포함)이 설치됩니다. 이후엔 `uv run <명령>`으로 실행하면 가상환경이 자동 적용됩니다. 직접 활성화하려면:

```bash
source server/.venv/bin/activate   # 해제: deactivate
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
open -e .env        # 텍스트 편집기로 열기
```

최소 설정 예시(OpenAI):

```env
JWT_SECRET=32자-이상의-임의-문자열
OPENAI_API_KEY=sk-...
```

Gemini를 쓰려면:

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

- `JWT_SECRET`은 `openssl rand -hex 32`로 만들 수 있습니다.
- 모델 이름은 본인 계정에서 쓸 수 있는 것으로 바꾸세요. vLLM 등 나머지 옵션은 [README.md](README.md#3-환경-변수-설정)와 `.env.example` 주석을 참고하세요.
- 서버는 **실행한 폴더의 `.env`** 를 읽습니다. 반드시 `server/`에서 실행하고, 수정 후엔 서버를 재시작하세요.

연결 확인(선택, `server/`에서):

```bash
uv run python -c "import asyncio; from app.config import Settings; from app.ai.llm import build_ai_clients; from app.ai.structured import RefineResult; c=build_ai_clients(Settings()); print(asyncio.run(c.question.json('질문을 다듬어라','회귀 분류 차이?',RefineResult))); print(len(asyncio.run(c.embedder.embed(['회귀']))[0]))"
```

### 데스크톱 — `desktop/.env` (선택, 서버 주소)

기본 서버 주소는 `http://localhost:8000`입니다. 포트를 바꿨다면:

```bash
echo 'VITE_API_BASE_URL=http://localhost:1111' > desktop/.env
```

빌드 시점에 반영되므로 수정 후 `npm run dev` 재시작 또는 `npm run build`를 다시 하세요. 로그인 화면의 "서버 주소"에서도 바꿀 수 있습니다(로그인 버튼을 눌러야 저장).

## 4. 실행

터미널 탭 3개를 사용합니다(⌘T).

**① 서버**

```bash
cd server
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

처음 실행 시 "Python이 들어오는 네트워크 연결을 허용하겠습니까?" 창이 뜨면 다른 PC의 학생이 접속할 경우 **허용**, 이 Mac에서만 쓸 경우 거부해도 됩니다.

**② 교사 앱**

```bash
cd desktop
npm run dev
```

**③ 학생 앱** — 교사·학생 로그인 정보가 섞이지 않도록 프로필을 분리한 빌드본으로 실행합니다.

```bash
cd desktop
npm run build
npx electron . --profile=student
```

> macOS에서는 창을 모두 닫아도 앱이 Dock에 남습니다. 완전히 종료하려면 ⌘Q.

## 5. 테스트·검사

```bash
cd server && uv run pytest -q     # API 키 불필요(가짜 AI 사용)
cd desktop && npm run typecheck
```

## macOS 주의사항

### 화면 기록 권한 (펜 표시 캡처에 필수)

학생이 펜으로 표시한 뒤 `질문 다듬기`를 누르면 화면을 캡처합니다. macOS는 **화면 기록 권한**이 없으면 배경화면만 찍히거나 빈 이미지가 됩니다.

1. **시스템 설정 → 개인정보 보호 및 보안 → 화면 및 시스템 오디오 녹음**
2. 앱을 실행한 **터미널 앱**(Terminal, iTerm2, VS Code 등)과, 목록에 보이면 **Electron**을 켭니다.
3. 권한을 바꾼 뒤엔 해당 터미널/앱을 **완전히 종료(⌘Q) 후 다시 실행**해야 적용됩니다.

### 전체 화면 앱 위에는 오버레이가 보이지 않음

macOS 전체 화면(초록 버튼, ⌃⌘F) 앱은 별도 Space로 분리되어 학생 오버레이가 그 위에 표시되지 않습니다. 강의 자료(PDF, 브라우저 등)는 **전체 화면 대신 창 최대화**(⌥ + 초록 버튼 또는 창 가장자리 더블클릭)로 띄우세요. 오버레이는 학생이 코드를 입력할 때 마우스 커서가 있던 모니터 하나만 덮습니다.

### 포트

- macOS의 **AirPlay 수신 모드**가 5000·7000 포트를 사용하므로 이 포트는 피하세요.
- 포트 사용 중 오류(`address already in use`)가 나면 점유 프로세스를 확인합니다:
  ```bash
  lsof -i :8000
  kill <PID>
  ```

### 폰트

UI 기본 폰트 "Malgun Gothic"은 macOS에 없으므로 시스템 한글 폰트(Apple SD Gothic Neo)로 자동 대체됩니다. 기능에는 영향 없습니다.

## 문제 해결

- **데이터 전체 초기화**: 서버를 끄고 `rm -rf server/data` 후 서버 재실행(업로드 파일 포함 전부 삭제).
- **특정 계정 삭제**("이미 가입된 이메일입니다"): DB는 WAL 모드라 GUI 도구에서 지울 땐 반드시 저장(커밋)하세요. 확실한 방법:
  ```bash
  cd server
  uv run python -c "import sqlite3; c=sqlite3.connect('data/askkup.db'); c.execute('PRAGMA foreign_keys=ON'); c.execute(\"delete from users where email='삭제할@이메일'\"); c.commit()"
  ```
- **교사로 가입했는데 학생 화면이 나옴**: 회원가입의 역할 기본값은 학생입니다. 가입 시 **교사**를 선택하세요.
- **실라버스 분석/주차 생성 실패**: API 키·모델 이름 확인 → 서버 재시작 → 실라버스 재업로드 또는 주차 `다시 생성`. 원인은 서버 터미널 로그에 표시됩니다.
- **`npm install` 중 Electron 다운로드 실패**: 네트워크 확인 후 `rm -rf node_modules && npm install` 재시도.
