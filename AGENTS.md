# Repository Guidelines

## 프로젝트 개요

ASKKUP(질문, 잇다)은 수업 중 생긴 학생 질문을 정리해 교사에게 익명으로 전달하는 AI 학습 지원 앱입니다. 학생은 투명 오버레이에 표시하거나 질문을 입력하고, AI가 다듬은 질문을 확인해 등록합니다. 교사는 강의계획서와 교안을 바탕으로 생성된 주차별 개념 맵을 편집하고, 실시간 수업 화면에서 질문을 확인합니다.

## 아키텍처

학생·교사 기능은 하나의 Electron 앱으로 제공하며, 화면은 React와 TypeScript로 구성합니다. Python FastAPI 서버가 인증, 질문 처리, AI 연동, 실시간 전달을 담당하고 SQLite에 커리큘럼과 질문을 저장합니다. AI 기능은 질문 다듬기와 필터링, 강의자료 기반 개념 생성, 질문 분류로 나뉩니다.

## 저장소 구조

상세 설계는 [docs/PLAN.md](docs/PLAN.md)가 기준입니다. `desktop/`은 Electron 앱(electron-vite, React, Tailwind), `server/`는 FastAPI 서버와 pytest 테스트, `references/`는 해커톤 기획 자료, `docs/`는 설계와 강의 자료를 담습니다. 변경 시 계획 문서의 와이어 계약(스키마·경로·오류 문구)을 서버와 `desktop/src/renderer/src/api/types.ts`에 함께 반영하세요.

## 실행·검증

- 서버: `server/.env.example`을 `server/.env`로 복사해 키 설정 → `cd server && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000`
- 서버 테스트: `cd server && uv run pytest -q`
- 데스크톱: `cd desktop && npm run dev` (학생 프로필 분리: `npm run build && npx electron . --profile=student`), 타입체크 `npm run typecheck`
