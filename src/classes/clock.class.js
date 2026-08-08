class Clock {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        // Load settings
        this.twelveHours = (window.settings.clockHours === 12);

        // Create DOM
        this.parent = document.getElementById(parentId);
        this.parent.innerHTML += `<div id="mod_clock" class="${(this.twelveHours) ? "mod_clock_twelve" : ""}">
            <h1 id="mod_clock_text"><span>?</span><span>?</span><span>:</span><span>?</span><span>?</span><span>:</span><span>?</span><span>?</span></h1>
            <div id="mod_clock_date"></div>
        </div>`;

        this.lastTime = new Date();

        this.updateClock();
        this.updater = setInterval(() => {
            this.updateClock();
        }, 1000);
    }
    updateClock() {
        let time = new Date();
        let array = [time.getHours(), time.getMinutes(), time.getSeconds()];

        // 12-hour mode translation
        if (this.twelveHours) {
            this.ampm = (array[0] >= 12) ? "PM" : "AM";
            if (array[0] > 12) array[0] = array[0] - 12;
            if (array[0] === 0) array[0] = 12;
        }

        array.forEach((e, i) => {
            if (e.toString().length !== 2) {
                array[i] = "0"+e;
            }
        });
        let clockString = `${array[0]}:${array[1]}:${array[2]}`;
        array = clockString.match(/.{1}/g);
        clockString = "";
        array.forEach(e => {
            if (e === ":") clockString += "<em>"+e+"</em>";
            else clockString += "<span>"+e+"</span>";
        });
        
        if (this.twelveHours) clockString += `<span>${this.ampm}</span>`;

        document.getElementById("mod_clock_text").innerHTML = clockString;

        // Current date, rendered under the time (absolute-positioned, so the
        // centered clock text never shifts — same pattern as the battery).
        const dateEl = document.getElementById("mod_clock_date");
        if (dateEl) {
            const DAYS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
            const pad = n => String(n).padStart(2, "0");
            dateEl.textContent = `${time.getFullYear()}.${pad(time.getMonth() + 1)}.${pad(time.getDate())} ${DAYS[time.getDay()]}`;
        }

        this.lastTime = time;
    }
}

module.exports = {
    Clock
};
