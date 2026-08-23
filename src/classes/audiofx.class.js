class AudioManager {
    constructor() {
        const path = require("path");
        const {Howl, Howler} = require("howler");

        if (window.settings.audio === true) {
            if(window.settings.disableFeedbackAudio === false) {
                this.stdout = new Howl({
                    src: [path.join(__dirname, "assets", "audio", "stdout.wav")],
                    volume: 0.4
                });
                this.stdin = new Howl({
                    src: [path.join(__dirname, "assets", "audio", "stdin.wav")],
                    volume: 0.4
                });
                this.folder = new Howl({
                    src: [path.join(__dirname, "assets", "audio", "folder.wav")]
                });
                this.granted = new Howl({
                    src: [path.join(__dirname, "assets", "audio", "granted.wav")]
                });
            }
            this.keyboard = new Howl({
                src: [path.join(__dirname, "assets", "audio", "keyboard.wav")]
            });
            this.theme = new Howl({
                src: [path.join(__dirname, "assets", "audio", "theme.wav")]
            });
            this.expand = new Howl({
                src: [path.join(__dirname, "assets", "audio", "expand.wav")]
            });
            this.panels = new Howl({
                src: [path.join(__dirname, "assets", "audio", "panels.wav")]
            });
            this.scan = new Howl({
                src: [path.join(__dirname, "assets", "audio", "scan.wav")]
            });
            this.denied = new Howl({
                src: [path.join(__dirname, "assets", "audio", "denied.wav")]
            });
            this.info = new Howl({
                src: [path.join(__dirname, "assets", "audio", "info.wav")]
            });
            this.alarm = new Howl({
                src: [path.join(__dirname, "assets", "audio", "alarm.wav")]
            });
            this.error = new Howl({
                src: [path.join(__dirname, "assets", "audio", "error.wav")]
            });

            // ---- Event sounds (user-provided, played via window.eventPlay) ----
            // Gated at play-time by settings.eventAudio (the master settings.audio
            // toggle is the constructor gate above). Each maps to a system event;
            // see eventPlay call sites in _renderer.js.
            const eventSounds = {
                boot_welcome:      "boot_welcome.wav",       // 开机 Welcome 文字
                battery_plug:      "battery_plug.wav",       // 插上电源
                battery_low40:     "battery_low40.wav",      // 电量 < 40%
                battery_low20:     "battery_low20.wav",      // 电量 ≤ 20%
                battery_critical:  "battery_critical.wav",   // 电量 ≤ 5% 即将关机
                wifi_first:        "wifi_first.wav",         // 会话内首次连网
                wifi_known:        "wifi_known.wav",         // 连接已知网络
                screensaver:       "screensaver.wav",        // 进入屏保
                screensaver_fx:    "expand.wav",             // 矩阵屏保入口音效(非人声,#190)
                lock_show:         "lock_show.wav",          // 屏保 → 锁屏
                lock_show_fx:      "panels.wav",             // 矩阵密码框出现音效(非人声,#190)
                unlock_ok:         "unlock_ok.wav",          // 解锁成功
                power_shutdown:    "power_shutdown.wav",     // 按下关机
                power_cancel:      "power_cancel.wav",       // 取消关机/重启
                power_reboot:      "power_reboot.wav",       // 按下重启
                settings_save:     "settings_save.wav",      // 设置保存到磁盘
                apt_check:         "apt_check.wav",          // 检查更新 ubuntu
                update_available:  "update_available.wav",   // 检测到可用升级
                update_done:       "update_done.wav",        // 升级完成待重启
                cliapp_update:     "cliapp_update.wav",      // 内置 cli app 更新完成
                error_popup:       "error_popup.wav"         // 报错弹窗出现
            };
            for (const [name, file] of Object.entries(eventSounds)) {
                this[name] = new Howl({
                    src: [path.join(__dirname, "assets", "audio", file)]
                });
            }

            Howler.volume(window.settings.audioVolume);
        } else {
            Howler.volume(0.0);
        }

        // Return a proxy to avoid errors if sounds aren't loaded
        return new Proxy(this, {
            get: (target, sound) => {
                if (sound in target) {
                    return target[sound];
                } else {
                    return {
                        play: () => {return true;}
                    }
                }
            }
        });
    }
}

module.exports = {
    AudioManager
};
