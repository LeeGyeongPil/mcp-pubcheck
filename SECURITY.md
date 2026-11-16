# 보안 정책 / Security policy

보안 취약점을 발견하셨다면 **공개 이슈 대신** 이 레포의 **Security → Report a vulnerability**(비공개 취약점 신고)로 알려 주세요. 확인 후 답변드리고, 고친 버전을 릴리스하면서 함께 안내합니다.

If you find a security issue, please **do not open a public issue**. Use **Security → Report a vulnerability** in this repository to report it privately. We will reply after checking and announce the fix with a release.

mcp-pubcheck 는 서버가 아니라 로컬 명령줄 도구입니다. 네트워크 포트를 열지 않고 네트워크 접근·키도 쓰지 않으며, 지정한 파일만 읽습니다(`--oci-inspect` 는 이미 만들어 둔 파일을 읽을 뿐 Docker 를 호출하지 않습니다). 지원하지 않는 압축 형식(zip64·희소 tar·암호화)은 건너뛰지 않고 오류로 멈춥니다. / mcp-pubcheck is a local command-line tool, not a server: it opens no network port, uses no network access or keys, and only reads the files you point it at (`--oci-inspect` only reads a file you already created; it does not call Docker). Unsupported archive features (zip64, sparse tar, encryption) stop the run with an error instead of being skipped.
