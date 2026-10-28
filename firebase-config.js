// 트리샘 EcoLenses — Firebase AI Logic 설정
// Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹)의 firebaseConfig 값을 그대로 붙여 넣으세요.
// 이 값들은 공개되어도 되는 식별용 값입니다. Gemini API 키는 여기에 넣지 않습니다.
// apiKey가 비어 있으면 분석기는 기존처럼 '이용자 API 키 입력' 방식으로 동작합니다.
window.TREESAM_FIREBASE = {
  firebaseConfig: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  },
  // App Check(reCAPTCHA) 사이트 키. 콘솔 > 보안 > App Check에서 웹 앱 등록 후 받은 키
  recaptchaSiteKey: "",
  // "v3" 또는 "enterprise" (App Check에 등록한 reCAPTCHA 종류)
  recaptchaProvider: "v3",
  model: "gemini-3.8-flash"
};
