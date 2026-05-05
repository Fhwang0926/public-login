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
npm start
```

개발 시 파일 변경 시 자동 재시작:

```bash
npm run dev
```

브라우저에서 **http://127.0.0.1:5000** 을 엽니다. 포트는 환경 변수 `PORT`로 바꿀 수 있습니다.

## 로그인

| 항목     | 값      |
|----------|---------|
| 아이디   | `admin` |
| 비밀번호 | `admin` |

첫 실행 시 SQLite 파일 `app.db`가 프로젝트 루트에 생성되고, 위 계정이 자동으로 만들어집니다.

## 기능

- 세션 기반 로그인 (`express-session`)
- 비밀번호 bcryptjs 해시 저장
- 로그인할 때마다 `login_logs` 테이블에 시각(UTC)과 IP 저장
- 로그인 후 대시보드에서 해당 사용자의 로그인 기록 목록 표시

## 운영 환경

프로덕션에서는 `SECRET_KEY` 환경 변수를 반드시 설정하세요.

```bash
set SECRET_KEY=무작위_긴_문자열   # Windows cmd
$env:SECRET_KEY="..."           # Windows PowerShell
export SECRET_KEY=...           # macOS / Linux
```

배포 전 개발용 기본 시크릿을 코드에서 교체하는 것도 가능하지만, 환경 변수 사용을 권장합니다.
