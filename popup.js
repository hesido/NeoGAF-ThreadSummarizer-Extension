// NeoGAF Thread Summarizer Copyright (c) 2015 hesido.com
"use strict";

document.addEventListener('DOMContentLoaded', function () {
	var activeTab = false,
	settings,
	//threadExtract,
	threadId,
	//thread,
	threadURL,
	threadCurPage,
	threadLastPage,
	threadTitle,
	command1 = document.getElementById("analyze"),
	command2 = document.getElementById("abort"),
	command3 = document.getElementById("show"),
	command4 = document.getElementById("clearcache"),
	message1 = document.getElementById("message"),
	coverdiv = document.getElementById("quotedisplaysettings"),
	inputvl1 = document.getElementById("threshold"),
	ordersel = document.getElementById("ordertype"),
	cacheset = document.getElementById("cachepage"),
	poplpage = document.getElementById("populpage"),
	follwusr = document.getElementById("followuser"),
	autorefr = document.getElementById("autorefreshlastpage"),
	//progress = document.getElementById("progress"),
	//progrbar = document.getElementById("bar"),
	setbuttn = document.getElementById("settingsbutton"),
	settndiv = document.getElementById("generalsettings"),
	refreshp = document.getElementById("autorefreshtext"),
	baranima = new $fleXanim.Prepare();

	baranima.setTemplate({
		template : "width:##%",
		values : [0]
	}).clearAnim().animate("bar"); //set template

	chrome.runtime.sendMessage(null, {
		action : "sendSettings"
	});

	chrome.tabs.query({
		currentWindow : true,
		active : true
	}, function (tabs) {
		activeTab = tabs[0];

		//chrome.tabs.executeScript(activeTab.id, {
		//	file : 'analyzepage.js'
		//});

		chrome.tabs.sendMessage(activeTab.id, {
			action : "pageInfoAnalyse",
		});

	});

	setbuttn.addEventListener('click', function () {
		settndiv.classList.toggle("activated");
	});

	chrome.runtime.onMessage.addListener(function (request, sender) {

		if (request.action == "popupUIcommand_applysettings") {

			settings = request.settings;
			inputvl1.value = settings.threshold;
			ordersel.selectedIndex = settings.ordertype;
			follwusr.value = settings.followuser;
			cacheset.checked = settings.cachepages;
			poplpage.checked = settings.populatepages;
			autorefr.value = settings.autorefreshevery;
			inputvl1.addEventListener("change", submitSetting);
			ordersel.addEventListener("change", submitSetting);
			follwusr.addEventListener("change", submitSetting);
			cacheset.addEventListener("change", submitSetting);
			poplpage.addEventListener("change", submitSetting);
			autorefr.addEventListener("change", submitSetting);
			setVisibility();
		};

		request.targetTab = request.targetTab || (sender.tab && sender.tab.id) || false;

		if (activeTab.id !== request.targetTab) //only display responses for that of the thread in the active tab.
			return;

		threadId = threadId || request.threadId || 0;

		if (request.action == "popupUIcommand_setThreadInfo") {
			//activate only when thread info is received. //the info can be shorthanded as request.
			threadURL = request.url;
			threadCurPage = request.curPage;
			threadLastPage = request.lastPage;
			threadTitle = request.threadTitle;
			
			command1.disabled = false;
			command1.addEventListener('click', function () {
				if (threadURL) {
					chrome.runtime.sendMessage(null, {
						action : "startAnalyze",
						threadId : threadId,
						url : threadURL,
						tabId : activeTab.id,
						curPage : threadCurPage,
						lastPage: threadLastPage,
						threadTitle : threadTitle
					});
				} else {
					message1.textContent = "Error: Cannot extract thread information."
				};

			});

			command2.addEventListener('click', function () {

				chrome.runtime.sendMessage(null, {
					action : "abortAnalyze",
					threadId : threadId,
					tabId : activeTab.id,
				});
				command1.disabled = false;
				command2.disabled = true;
				message1.textContent = "Aborted analysis, waiting for processes to finish";
				progressBar(0, 40);

			});

			command3.addEventListener('click', function () {
				chrome.runtime.sendMessage(null, {
					action : "displayResults",
					threadId : threadId,
					//threshold : inputvl1.value,
					//listusers : follwusr.value,
					//sortByQuoteNo : ordersel.selectedIndex,
					tabId : activeTab.id
				});
			});

			command4.addEventListener('click', function () {
				chrome.runtime.sendMessage(null, {
					action : "clearThreadData",
					threadId : threadId,
					tabId : activeTab.id,
				});
				coverdiv.classList.remove("activated");
				command1.disabled = false;
				command3.disabled = true;
			});

		};

		if (request.action == "popupUIcommand_displayThreadStatus") {

			message1.textContent = "Thread status: " + request.status;
			if (request.status == "Analysis in progress") {
				command2.disabled = false;
			};
			if (request.status == "Analysis completed") {
				coverdiv.classList.add("activated");
				command2.disabled = true;
				command3.disabled = false;
				command4.disabled = false;
				progressBar(100, 10);
			};

			if (request.status == "Cleared thread cache") {
				message1.textContent = request.status;
				progressBar(0, 20);
				command1.disabled = false;
				command3.disabled = true;
				coverdiv.classList.remove("activated");
			};

		};

		if (request.action == "popupUIcommand_analyzing") {

			command1.disabled = true;
			command2.disabled = false;
			message1.textContent = "Analysis in progress";
		};

		if (request.action == "popupUIcommand_displayProgress") {
			var percentage = parseInt(((request.pageNo - request.analyzeStartPage + 1) / (request.lastPage - request.analyzeStartPage + 1)) * 100);
			if (request.status !== "Analysis in progress")
				return;
			progressBar(percentage);
		};

		if (request.action == "popupUIcommand_analyzedAlert") {

			command2.disabled = true;
			progressBar(100, 15);
			message1.textContent = request.message;
		};

		if (request.action == "popupUIcommand_analyzeComplete") {

			command2.disabled = true;
			coverdiv.classList.add("activated");
			command3.disabled = false;
			command4.disabled = false;
			message1.textContent = "Analysis completed";
			progressBar(100, 15);
		};

		if (request.action == "popupUIcommand_error") {

			message1.textContent = request.message;
		};

		if (request.action == "popupUIcommand_message") {

			message1.textContent = request.message;
		};

	});
	
	function setVisibility() {
		if(!settings.cachepages) refreshp.classList.add("disabled");
		else refreshp.classList.remove("disabled");
	}

	function submitSetting() {
		settings.threshold = inputvl1.value;
		settings.ordertype = ordersel.selectedIndex;
		settings.followuser = follwusr.value;
		settings.cachepages = cacheset.checked;
		settings.populatepages = poplpage.checked;
		settings.autorefreshevery = autorefr.value;
		setVisibility();

		chrome.runtime.sendMessage(null, {
			action : "receiveSettings",
			settings : settings,
			tabId : activeTab.id
		});

	};

	function progressBar(percentage, frameLength) {
		baranima.reset().setAnimation({
			template : "width:##%",
			endVal : [percentage],
			frames : frameLength || 8,
			tween : "easeout"
		}).clearAnim().animate("bar");
	};

});

//fleXanim v1.1 beta 5 //minimal animation library by hesido.com
var $fleXanim = {
	aeT : {},
	Prepare : function () {
		this.aeL = {};
		this.aQ = []
	}
};
$fleXanim.Prepare.prototype = {
	setAnimation: function (s) {
		if (!s.cachE)
			s.cachE = {
				aP: s.template.split("##"),
				fP: [],
				fr: s.frames || 25,
				ms: s.milisecs || 16,
				tw: s.tween || "smooth"
			};
		var cV = s.cachE;
		for (var i = 1, reg = /^\.#/, aP, tT; aP = cV.aP[i]; i++) {
			tT = reg.test(aP);
			cV.fP[i - 1] = tT;
			if (tT)
				cV.aP[i] = aP.slice(2)
		};

		this.aQ.push(s);
		return this
	},
	setTemplate: function (s) {
		var aP = s.template.split("##");
		for (var i = 0, reg = /^\.#/, propS = '', rP; aP[i]; i++) {
			rP = s.values[i] || 0;
			propS += aP[i].replace(reg, '') + rP
		};
		s.stylE = propS;
		this.aQ.push(s);
		return this
	},
	run: function (f) {
		this.aQ.push({
			func: f
		});
		return this
	},
	forward: function (reF, pD) {
		var aE = this.aeL[reF];
		if (!aE)
			return;
		aE.pD = pD || 1;
		if (!aE.animInt)
			this.runAnim(aE.paused || (pD && pD < 0 && this.aQ.length - 1) || 0, reF);
		aE.paused = false
	},
	reverse: function (reF) {
		this.forward(reF, -1)
	},
	animate: function (reF) {
		if (!this.aeL[reF])
			this.init(reF);
		this.forward(reF)
	},
	init: function (reF) {
		this.aeL[reF] = {
			aI: 0,
			sV: [],
			eV: [],
			ref: reF,
			elm: document.getElementById(reF)
		};
		$fleXanim.aeT[reF] = $fleXanim.aeT[reF] || {};
		return this.aeL[reF]
	},
	clearAnim: function () {
		this.aQ.push({
			clear: true
		});
		return this
	},
	delay: function (dA) {
		this.aQ.push({
			delay: dA
		});
		return this
	},
	loopBegin: function () {
		this.loopStart = this.aQ.length;
		return this
	},
	loop: function (n) {
		this.aQ.push({
			doLoop: true,
			loopTimes: n || -1,
			loopStart: this.loopStart || 0
		});
		return this
	},
	setStyle: function (p) {
		this.aQ.push({
			stylE: p
		});
		return this
	},
	breakLoop: function (reF) {
		this.aeL[reF].breakOut = true
	},
	reset: function () {
		this.pause(false, true);
		this.aQ = [];
		this.aeL = {};
		return this
	},
	pause: function (reF, reset) {
		if (!reF) {
			for (var i in this.aeL) {
				if (this.aeL[i].sV)
					this.pause(i, reset)
			};
			return
		};
		var aE = this.aeL[reF];
		if (!aE)
			return;
		window.clearInterval(aE.animInt);
		window.clearTimeout(aE.animInt);
		aE.animInt = false;
		if (!reset)
			aE.paused = aE.aI
	},
	applyStyle: function (p, elm) {
		var sL = p.match(/[^:;]+/g);
		for (var i = 0, proP, vaL; proP = sL[i]; i += 2) {
			vaL = sL[i + 1];
			elm.style[proP] = vaL
		}
	},
	runAnim: function (inD, reF) {
		var aO = this,
		aE = this.aeL[reF],
		s,
		aV,
		fW = (aE.pD > 0),
		svH,
		evH;
		aE.aI = inD;
		aE.animRun = true;
		if (!(s = aO.aQ[inD]))
			return;
		if (aE.animInt)
			return;
		if (s.clear) { this.aeL[reF] = null; delete this.aeL[reF]; return; }
		if (s.func)
			s.func(aE);
		if (s.doLoop) {
			if (!aE.loopHub)
				aE.loopCount = fW ? 0 : s.loopTimes + 1;
			aE.loopCount += aE.pD;
			if ((s.loopTimes == -1 || (aE.loopCount <= s.loopTimes && aE.loopCount >= 0)) && !aE.breakOut) {
				aE.loopHub = inD;
				aE.loopStart = s.loopStart;
				aO.runAnim(fW ? aE.loopStart : inD - 1, reF);
				return
			} else {
				aE.loopHub = aE.breakOut = false;
				aO.runAnim(fW ? inD + 1 : aE.loopStart - 1, reF);
				return
			}
		};
		if (s.stylE)
			aO.applyStyle(s.stylE, aE.elm);
		if (s.values)
			$fleXanim.aeT[reF][s.template] = s.values.slice(0);
		if (s.delay) {
			aE.animInt = window.setTimeout(function () {
				aE.animInt = false;
				aO.runAnim(inD + aE.pD, reF)
			}, s.delay);
			return
		};
		if (!(aV = s.cachE)) {
			aO.runAnim(inD + aE.pD, reF);
			return
		};
		aE.cF = aE.cF || (fW ? 0 : aV.fr);
		aE.currentVal = [];
		if (!aE.sV[inD])
			aE.sV[inD] = (s.startVal && s.startVal.slice(0)) || $fleXanim.aeT[reF][s.template] || [];
		svH = aE.sV[inD];
		if (!aE.eV[inD])
			aE.eV[inD] = (s.endVal && s.endVal.slice(0)) || [];
		evH = aE.eV[inD];
		for (var i = 0, j = (s.relVal && s.relVal.length) || 0, rV; i < j; i++) {
			rV = s.relVal[i];
			evH[i] = (svH[i] || 0) + rV

		};

		aE.animInt = window.requestAnimationFrame(executeAnim);
		function executeAnim() {
			for (var i = 0, propS = '', rP; aV.aP[i]; i++) {
				rP = ((svH[i] || svH[i] === 0) && (evH[i] || evH[i] === 0) && aO.animStep[aV.tw](aE.cF, svH[i], evH[i], aV.fr));
				rP = (rP || rP === 0) ? rP : ""; //added in 1.1 beta - a more elegant and shorter solution is welcome.
				rP = (rP && aV.fP[i] === false) ? parseInt(rP) : rP;
				propS += aV.aP[i] + rP;
				aE.currentVal[i] = rP
			};
			aO.applyStyle(propS, aE.elm);
			$fleXanim.aeT[reF][s.template] = aE.currentVal.slice(0);
			if (s.run)
				s.run(aE);
			aE.cF += aE.pD;
			if (aE.cF > aV.fr || aE.cF < 0) {
				aE.cF = aE.animInt = false;
				delete aE.currentVal;
				aE.aI += aE.pD;
				if (aE.loopHub && aE.pD < 0 && aE.aI < aE.loopStart)
					aE.aI = aE.loopHub;
				if (aO.aQ[aE.aI])
					aO.runAnim(aE.aI, reF);
				else
					aE.animRun = false
			} else
				aE.animInt = window.requestAnimationFrame(executeAnim)
		}
	},
	animStep: {
		smooth: function (t, b, c, d) {
			c -= b;
			var ts = (t /= d) * t,
			tc = ts * t;
			return (b + c * (-2 * tc + 3 * ts))
		},
		easein: function (t, b, c, d) {
			c -= b;
			var ts = (t /= d) * t * t;
			return (b + c * (ts))
		},
		easeout: function (t, b, c, d) {
			c -= b;
			var ts = (t /= d) * t,
			tc = ts * t;
			return (b + c * (tc - 3 * ts + 3 * t))
		},
		linear: function (t, b, c, d) {
			c -= b;
			t /= d;
			return (b + c * (t))
		}
	}
};
