# public-login

Bio-Pass OAuth 연동과 로컬 데모 로그인을 함께 제공하는 Node.js(Express) 샘플 사이트입니다. 로그인할 때마다 SQLite에 기록을 남기고, 대시보드에서 확인할 수 있습니다.

## 요구 사항

- [Node.js](https://nodejs.org/) 18 이상
- Bio-Pass 백엔드가 동작 중이어야 Bio-Pass 로그인 사용 가능 (예: `http://127.0.0.1:3030`)

`sql.js`·`bcryptjs`만 사용하므로 **네이티브 애드온 빌드(node-gyp) 없이** `npm install`이 됩니다.

## 설치 및 실행

```bash
git clone <저장소 URL>
cd public-login
npm install
cp .env.example .env   # Windows: Copy-Item .env.example .env
```

`.env`에 Bio-Pass 앱의 **Client ID**, **Client Secret**(`secret_`로 시작), **Callback URL**을 맞춘 뒤:

```bash
npm start
# 개발: npm run dev
```

브라우저에서 **http://127.0.0.1:5000** (또는 `.env`의 `PORT`)을 엽니다.

## Bio-Pass 로그인 절차

1. 로그인 화면에서 **이메일**을 입력하고 **Bio-Pass로 로그인**을 클릭합니다.  
   (선택) 전화번호를 넣으면 authorize URL에 `phone` 파라미터도 함께 전달됩니다.
2. 서버가 Bio-Pass `/web/authorize`로 리다이렉트합니다.  
   - `scope=email,phone`  
   - `email=입력한_이메일`  
   - `redirect_uri` · `client_id` · `state` 등 OAuth 파라미터 포함
3. Bio-Pass에서 이메일/앱 인증을 완료하면 `/auth/callback?code=...&state=...`로 돌아옵니다.
4. 서버가 **서버에서만** `POST /web/token` → `POST /web/verify-token`을 호출해 사용자를 확인하고 세션을 만듭니다.
5. **대시보드**(`/dashboard`)로 이동합니다.

bio-pass 앱 설정과 `.env`가 일치해야 합니다.

| 항목 | 예시 |
|------|------|
| Callback URL | `http://localhost:5000/auth/callback` |
| Client Secret | `secret_...` (Client ID `app_...`와 **다른 값**) |
| Scope | `email,phone` (앱 loginIdentifier가 `both` 등 phone 지원일 때) |
| State | `.env`의 `BIO_PASS_OAUTH_STATE` (예: `test`) |

## 로그인 후 화면 (동작 결과)

Bio-Pass 인증이 성공하면 아래와 같은 **대시보드**가 표시됩니다.

### 상단 알림

- 초록색 배너: **「Bio-Pass로 로그인되었습니다.」**

### Bio-Pass API 결과 (대시보드)

bio-pass 백엔드(`token.js`) 응답 형식 그대로 표시합니다.

**POST /web/token 응답**

| 필드 | 예시 |
|------|------|
| `access_token` | JWT (화면에서는 마스킹) |
| `token_type` | `Bearer` |
| `expires_in` | `21600` (초) |
| `refresh_token` | JWT (마스킹) |
| `scope` | `email phone` |

**POST /web/verify-token 응답**

```json
{
  "success": true,
  "authenticated": true,
  "user": {
    "id": "usr_...",
    "email": "user@example.com",
    "name": "표시이름",
    "nickname": "닉네임",
    "phone": null,
    "status": "ACTIVE"
  }
}
```

`user` 필드는 `resolveVerifiedUser()` 결과이며, 값이 없으면 `null`로 표시됩니다.

### 사용자 영역

- 인사말: **「안녕하세요, `{name}`」** (없으면 nickname → email → phone → id 순)
- 부가 설명: **「SQLite에 저장된 로그인 기록입니다.」**
- 파란 **Bio-Pass** 뱃지: Bio-Pass로 로그인했음을 표시합니다.
- **로그아웃** 버튼: 세션을 종료하고 로그인 화면으로 돌아갑니다.

### 로그인 기록 테이블

| 열 | 내용 |
|----|------|
| # | 순번 |
| 로그인 시각 (UTC) | ISO 8601 형식 (예: `2026-06-04T02:28:26.587Z`) |
| IP | 접속 IP (로컬 개발 시 `127.0.0.1` 등) |

Bio-Pass로 로그인할 때마다 `login_logs` 테이블에 시각·IP가 추가되며, 같은 사용자의 기록만 대시보드에 나열됩니다.

### 데이터 저장

- 사용자: SQLite `users` (`bio_pass_id`로 Bio-Pass 계정과 연결)
- 로그: SQLite `login_logs`
- DB 파일: 프로젝트 루트 `app.db` (첫 실행 시 생성)

## 로컬 데모 계정

Bio-Pass 없이도 아래 계정으로 로그인할 수 있습니다. (첫 실행 시 자동 생성)

| 항목 | 값 |
|------|-----|
| 아이디 | `admin` |
| 비밀번호 | `admin` |

로컬 로그인 시에도 동일한 대시보드·로그인 기록 UI가 표시되며, Bio-Pass 뱃지는 나오지 않습니다.

## 환경 변수 (.env)

| 변수 | 설명 |
|------|------|
| `PORT` | HTTP 포트 (기본 5000) |
| `SECRET_KEY` | 세션 암호화 키 |
| `BIO_PASS_API` | Bio-Pass API 베이스 (예: `http://127.0.0.1:3030/api`) |
| `BIO_PASS_CLIENT_ID` | 앱 Client ID (`app_...`) |
| `BIO_PASS_CLIENT_SECRET` | 앱 Client Secret (`secret_...`) |
| `BIO_PASS_REDIRECT_URI` | Callback URL (앱 등록값과 동일) |
| `BIO_PASS_OAUTH_STATE` | authorize/callback `state` (선택) |
| `BIO_PASS_SCOPE` | 기본 `email,phone` |

## 주요 기능

- Bio-Pass OAuth 2.0 (authorization code) + 이메일 파라미터 전달
- 세션 기반 로그인 (`express-session`)
- 로컬 계정 bcrypt 해시 저장
- 로그인 시각(UTC)·IP 기록 및 대시보드 조회

## 트러블슈팅

| 증상 | 확인 |
|------|------|
| `유효하지 않은 client_secret` | `.env`의 Secret이 `secret_`로 시작하는지, Client ID와 다른지 |
| `OAuth state가 일치하지 않음` | `.env`의 `BIO_PASS_OAUTH_STATE`와 authorize 시 `state` 일치 |
| `invalid_grant` / code 오류 | authorization code는 1회용 — 다시 로그인해 새 code 받기 |
| Bio-Pass 버튼만 있고 로그인 실패 | bio-pass 백엔드 URL·앱 Callback URL·scope(loginIdentifier) 확인 |

## 운영 환경

프로덕션에서는 `.env`의 `SECRET_KEY`를 긴 무작위 값으로 바꾸세요.

```bash
export SECRET_KEY=...   # macOS / Linux
```

`client_secret`은 서버 환경 변수에만 두고 브라우저·프론트 코드에 넣지 마세요.
