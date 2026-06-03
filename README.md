# public-login

SQLite 기반 로그인과 로그인 기록 조회를 제공하는 간단한 Node.js(Express) 웹 앱입니다.

## 요구 사항

- [Node.js](https://nodejs.org/) 18 이상

`sql.js`·`bcryptjs`만 사용하므로 **네이티브 애드온 빌드(node-gyp) 없이** `npm install`이 됩니다. (다른 PC·Node 버전에서도 동일하게 동작하기 쉽게 구성했습니다.)

## 설치 및 실행

```bash
git clone <저장소 URL>
cd public-login
npm install
```

환경 변수는 프로젝트 루트의 **`.env`** 에서 읽습니다. 샘플을 복사해 만듭니다.

```bash
# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

이후 실행:

```bash
npm start
```

개발 시 파일 변경 시 자동 재시작:

```bash
npm run dev
```

브라우저에서 **http://127.0.0.1:5000** 을 엽니다. (`.env`의 `PORT` 또는 셸에서 `PORT`로 변경 가능)

## 로그인

### Bio-Pass (권장)

Bio-Pass 관리 콘솔에서 애플리케이션을 만들고 **Callback URL**을 이 샘플과 동일하게 등록합니다.

| 항목 | 예시 |
|------|------|
| Callback URL | `http://127.0.0.1:5000/auth/callback` (`.env`의 `PORT`·`BIO_PASS_REDIRECT_URI`와 일치) |
| `BIO_PASS_API` | bio-pass 백엔드 API 베이스 (예: `http://127.0.0.1:3030/api`) |

`.env`에 `BIO_PASS_CLIENT_ID`, `BIO_PASS_CLIENT_SECRET`, `BIO_PASS_REDIRECT_URI` 등을 설정한 뒤 실행하면 로그인 화면에 **Bio-Pass로 로그인** 버튼이 표시됩니다. 흐름은 bio-pass 개발자 문서의 OAuth 샘플과 동일합니다.

1. `/auth/biopass` → Bio-Pass `/web/authorize`
2. 인증 완료 후 `/auth/callback?code=...&state=...`
3. 서버에서 `/web/token` · `/web/verify-token` 호출 후 세션 생성

`client_secret`은 서버 환경 변수에만 두며 브라우저에 노출하지 않습니다.

### 로컬 데모 계정

| 항목     | 값      |
|----------|---------|
| 아이디   | `admin` |
| 비밀번호 | `admin` |

첫 실행 시 SQLite 파일 `app.db`가 프로젝트 루트에 생성되고, 위 계정이 자동으로 만들어집니다.

## 기능

- Bio-Pass OAuth 2.0 (authorization code) 연동
- 세션 기반 로그인 (`express-session`)
- 비밀번호 bcryptjs 해시 저장 (로컬 계정)
- 로그인할 때마다 `login_logs` 테이블에 시각(UTC)과 IP 저장
- 로그인 후 대시보드에서 해당 사용자의 로그인 기록 목록 표시

## 운영 환경

프로덕션에서는 `.env`의 `SECRET_KEY`를 긴 무작위 값으로 바꾸거나, 호스트에서 환경 변수로 덮어쓰세요. (`.env`가 있으면 우선 적용됩니다.)

```bash
set SECRET_KEY=무작위_긴_문자열   # Windows cmd
$env:SECRET_KEY="..."           # Windows PowerShell
export SECRET_KEY=...           # macOS / Linux
```

배포 전 개발용 기본 시크릿을 코드에서 교체하는 것도 가능하지만, `.env` 또는 환경 변수 사용을 권장합니다.
