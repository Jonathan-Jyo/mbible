// 음성 재생 관리
const AudioManager = {
  player: null,
  isPlaying: false,
  btn: null,
  _presetSrc: null,   // 현재 과의 기본 음성 경로
  _hasPreset: false,  // 기본 음성 존재 여부

  init() {
    this.player = document.getElementById("audio-player");
    this.btn = document.getElementById("audio-btn");

    this.player.addEventListener("ended", () => {
      this.isPlaying = false;
      this.updateBtn();
    });

    this.player.addEventListener("error", () => {
      this.isPlaying = false;
      this.updateBtn();
    });

    // 클릭 이벤트는 app.js의 bindEvents()에서 처리
    // (음성 패널을 열어 기본/개인 음성을 선택하도록)
  },

  load(audioFile) {
    this.stop();
    this._presetSrc  = audioFile || null;
    this._hasPreset  = !!audioFile;
    if (audioFile) {
      this.player.src = audioFile;
      this.player.load();
    } else {
      this.player.src = "";
    }
    // 개인 녹음 기능을 위해 버튼은 항상 표시
    if (this.btn) this.btn.style.display = "flex";
  },

  // 특정 URL을 직접 재생 (기본 음성 패널에서 호출)
  playPreset() {
    if (!this._presetSrc) return;
    this.player.src = this._presetSrc;
    this.player.play().catch(() => {});
    this.isPlaying = true;
    this.updateBtn();
  },

  toggle() {
    if (!this.player.src) return;
    if (this.isPlaying) {
      this.player.pause();
      this.isPlaying = false;
    } else {
      this.player.play().catch(() => {});
      this.isPlaying = true;
    }
    this.updateBtn();
  },

  stop() {
    if (this.player) {
      this.player.pause();
      this.player.currentTime = 0;
      this.isPlaying = false;
      this.updateBtn();
    }
  },

  updateBtn() {
    if (this.btn) {
      this.btn.classList.toggle("playing", this.isPlaying);
    }
  }
};
