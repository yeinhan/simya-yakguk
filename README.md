# 심야약국

지금 문 연 약국, 심야·주말·공휴일 약국을 찾는 모바일 우선 사이트. 정적 사이트(`public/`) + 매일 갱신되는 약국 데이터.

## 구조
- `scripts/update-data.mjs` : 공공데이터포털 "전국 약국 정보 조회 서비스"를 받아 `public/data/g/*.json`(0.1° 격자)로 저장
- `.github/workflows/update-data.yml` : 매일 03:00(KST) 실행, 변경분 커밋
- `public/` : 사이트. 카카오 지도 키가 없으면 간이 지도로 동작
- `scripts/build.mjs` : Vercel 빌드 시 `KAKAO_JS_KEY` → `public/config.js`, 그리고 검색엔진용 페이지 생성
- `scripts/seo-pages.mjs` : 지역 페이지(`/서울/`, `/서울/관악구/` 등), `sitemap.xml`, `robots.txt` 생성. 데이터가 매일 갱신되면 재배포되면서 같이 갱신
- 약국 상세의 길 안내: 카카오맵 / 네이버지도 버튼 (키 필요 없음). 휴대폰에선 네이버지도 앱을 열고, 앱이 없거나 PC면 네이버지도 웹 검색으로 열림

## 설정
1. GitHub → Settings → Secrets and variables → Actions → `DATA_GO_KR_KEY` (공공데이터포털 인증키)
2. Actions 탭 → "Update pharmacy data" → Run workflow (최초 1회)
3. Vercel에서 저장소 import, 환경변수 `KAKAO_JS_KEY`(JavaScript 키) 추가
4. 카카오 개발자 콘솔 → 플랫폼 → Web에 배포 도메인 등록, 카카오맵 사용 ON
5. (검색 등록) Vercel 환경변수 `NAVER_SITE_VERIFICATION`, `GOOGLE_SITE_VERIFICATION`에 소유확인 메타태그의 content 값을 넣고 재배포. 도메인을 바꾸면 `SITE_URL`(예: `https://example.com`)도 설정

## 로컬 실행
```
node scripts/sample-data.mjs && node scripts/build.mjs && npx serve public
```
