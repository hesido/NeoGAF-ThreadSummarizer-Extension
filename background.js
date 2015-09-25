// NeoGAF Thread Summarizer Copyright (c) 2015 hesido.com
"use strict";
var threadData = {},
threadCachedPages = {},
settings = {
	settingsVersion: 1.1,
	minimumCompatibleSettingsVersion: 1.0,
	threshold: 3,
	ordertype: 0,
	followuser: "Lionel Mandrake",
	cachepages: true,
	usecacheforanalysis: true,
	pagecachetimelimit: 15, //in minutes
	analysiscachetimelimit: 15, // in minutes
	populatepages: true,
	onpageactions: true
}; //set defaults first without waiting for the local storage callback just in case

chrome.storage.sync.get(settings, function (savedSettings) {
	if (savedSettings.settingsVersion < settings.minimumCompatibleSettingsVersion) {
		chrome.storage.sync.clear();
		chrome.storage.sync.set(settings);
	} else
		settings = savedSettings; //receive settings from local storage
});

chrome.webNavigation.onCommitted.addListener(inspectTab, {
	url: [{
		hostSuffix: 'neogaf.com'
	}
	]
});

chrome.alarms.onAlarm.addListener(function (alarm) {
	var info = alarm.name.split(":"),
	thread = threadData[info[1]] || false;
	if (!thread)
		return;
	if (info[0] == "pageCacheRemove")
		thread.removePageCaches();
	if (info[0] == "analysisCacheRemove")
		threadData[info[1]] = new threadSetup("Ready for analysis", info[1]);
});

function threadSetup(status, threadId) {
	this.status = status;
	this.quotedList = {}; //quotedList[postId] = [page_number,post_count,times_quoted,"quoter_post_id:quoter_post_count"]
	this.postsInfo = "";
	//this.analyzedURL = "%%"; //dev note: disabled this line, as this information is no longer used (maybe in future, in a page list format instead of uri)
	// this.cachedPageList = ",";
	threadCachedPages[threadId] = threadCachedPages[threadId] || {
		lastCachedPage: false
	}; //making it ready from moving
	//stores downloaded pages in the form threadCachedPages[threadId]{cachedPageList, [page1], [page2]}
	//downloaded times in the threadCachedPages[threadId]{[pagetime1], [pagetime2]} for download time etc.
	//this.pageCaches = threadCachedPages[threadId]; //this is just a reference
	this.abort = false; //abort when tolerance is exhausted
	this.loadError = [];
	this.activeTabId = false; // stores the tab Id to direct messaging
	//this.activeURL = false; //stores url that's being processed //disabled: not being anything used for now
	this.analyzeStartPage = false; //stores analyze start page number
	this.curPage = false; //stores the page number that's being analyzed
	this.lastCachedPage = threadCachedPages[threadId].lastCachedPage || false; //stores the last cached page, set in this.addPageToCache
	this.baseURL = threadCachedPages[threadId].baseURL || ""; //stores base url //anything that is re-set from cache objects are things that cache related thread methods require when running
	//this is needed because analysis caches and page caches can be deleted separately

	this.lastPage = false; //stores last page number
	//this.cachedPages = {}; //stores downloaded pages in the form thread.cachedPages[page1], [page2] etc.
	this.threadId = threadId;
	this.threadTitle = "";
};

threadSetup.prototype = {
	tolerance: 0, //abort at first error
	removePageCaches: function () {
		threadCachedPages[this.threadId] = null;
		delete threadCachedPages[this.threadId];
	},
	addPageToCache: function (pageNo, htmlstring, tabId) {
		if (!threadCachedPages[this.threadId])
			threadCachedPages[this.threadId] = {
				lastCachedPage: false,
				baseURL: this.baseURL
			};
		var cacheHolder = threadCachedPages[this.threadId],
		time = new Date();
		cacheHolder.lastCachedPage = cacheHolder.lastCachedPage || pageNo;
		if (pageNo > cacheHolder.lastCachedPage)
			cacheHolder.lastCachedPage = pageNo;

		this.lastCachedPage = cacheHolder.lastCachedPage;

		cacheHolder["page" + pageNo] = htmlstring;
		cacheHolder["pagetime" + pageNo] = time.getTime();
		cacheHolder["cachedPageList"] = cacheHolder["cachedPageList"] || ",";

		if (tabId)
			chrome.tabs.sendMessage(tabId, {
				action: "resreshPageResponse",
				pageHTMLstring: cacheHolder["page" + pageNo],
				cacheTime: cacheHolder["pagetime" + pageNo]
			});

		if (cacheHolder["cachedPageList"].indexOf("," + pageNo + ",") == -1)
			cacheHolder["cachedPageList"] += pageNo + ",";
		chrome.alarms.create("pageCacheRemove:" + this.threadId, {
			delayInMinutes: settings.pagecachetimelimit * 1
		});
	},
	readPageCache: function (pageNo) { //dev note: it may not really be necessary to have this as a method
		var cacheHolder = threadCachedPages[this.threadId]
		return (cacheHolder && cacheHolder["page" + pageNo]) || false;
	},
	loadURL: function (url) {
		var threadRex = /((https?:\/\/.*\.?neogaf\.com)\/.*)showthread.php\?.*/,
		curPage,
		pageNoRex = /(?:\?|&)page=(\d+)/,
		matchedURL,
		useCache = settings.cachepages && settings.usecacheforanalysis,
		cachedPage = null;

		if (matchedURL = url.match(threadRex)) {
			curPage = matchedURL[0].match(pageNoRex);
			curPage = (curPage && curPage[1]) || 1;
		} else {
			this.handleError({
				page: url,
				type: "load"
			});
			return false;
		};

		if (this.abort) {
			chrome.runtime.sendMessage(null, {
				action: "popupUIcommand_error",
				targetTab: this.activeTabId,
				message: "Analysis interrupted"
			});
			threadData[this.threadId] = new threadSetup("Aborted analysis", this.threadId);
			return;
		};

		this.curPage = curPage;

		if ((this.lastCachedPage && this.lastCachedPage == curPage) || curPage == this.lastPage)
			useCache = false;

		//this.lastCachedPage = this.lastCachedPage || curPage;
		//if (curPage > this.lastCachedPage)
		//	this.lastCachedPage = curPage;
		//this.activeURL = url;
		this.status = "Analysis in progress";
		chrome.runtime.sendMessage(null, {
			action: "popupUIcommand_analyzing",
			targetTab: this.activeTabId
		});

		if (useCache && (cachedPage = this.readPageCache(curPage))) {
			var parser = new DOMParser(),
			parsed = parser.parseFromString(cachedPage, "text/html");
			this.processPage(parsed, url, curPage, matchedURL[1], matchedURL[2])
			return;
		};

		this.loadPage({
			pageNo: curPage,
			URI: matchedURL
		});

	},

	loadPage: function (details) {
		var url = this.baseURL + "&page=" + details.pageNo;

		try {
			var r = new XMLHttpRequest();
			r.open("GET", url, true);
			r.responseType = "text";
			r.onerror = (function () {
				this.handleError({
					page: url,
					type: "load"
				});
			}).bind(this);
			r.onload = (function () {
				var parser = new DOMParser(),
				parsed = parser.parseFromString(r.response, "text/html");
				if (settings.cachepages)
					this.addPageToCache(details.pageNo, r.response, details.tabId || false);
				if (details.URI)
					this.processPage(parsed, url, details.pageNo, details.URI[1], details.URI[2]); //only process if called from loadURL
			}).bind(this);
			r.send(null);
		} catch (e) {
			this.handleError({
				page: url,
				type: "load"
			});
		};

	},

	processPage: function (page, url, pageNo, baseURI, rootURI) {
		if (this.abort) {
			chrome.runtime.sendMessage(null, {
				action: "popupUIcommand_error",
				targetTab: this.activeTabId,
				message: "Analysis interrupted"
			});

			threadData[this.threadId] = new threadSetup("Aborted analysis", this.threadId);
			return;
		};

		var quoteAnchors = page.querySelectorAll("p.cite>a"),
		postCTAnchors = page.querySelectorAll("a[id^='postcount']"),
		strTester,
		anchorRex = /.*post(\d+)$/,
		postIdRex = /post_message_(\d+)/,
		postCtRex = /showpost.php\?p=(\d+)&postcount=(\d+)/,
		//threadRex = /((https?:\/\/.*\.?neogaf\.com)\/.*)showthread.php\?.*/,
		absURIRex = /^https?:\/\//, //check if the uri is absolute or not.
		relURIRex = /^\//, //normalize relative URI.
		//postCTString = "", //string that contains post counts of every message
		//quoted = {}, //List that contains how many times posts are quoted. quoted[quotedPostId]=times_quoted_integer;
		//quoters = {}, //List that contains posts that quoted a post along with the post counts. quoters[quotedPostId]=quoting_post_ids_string;
		quoterInfo,
		usernameHolder,
		matcher,
		username;

		//if (this.analyzedURL.indexOf("%%" + url + "%%") == -1)
		//	this.analyzedURL += url + "%%";

		for (var i = 0, pcAnchor, pcExtract; pcAnchor = postCTAnchors[i]; i++) {
			pcExtract = (strTester = pcAnchor.getAttribute('href')) && strTester.match(postCtRex);
			if (pcExtract && this.postsInfo.indexOf(pcExtract[1] + ":") == -1) {
				usernameHolder = page.querySelector("#postmenu_" + pcExtract[1] + ">a");
				username = (usernameHolder != null && (strTester = usernameHolder.getAttribute('href')) && strTester.indexOf("member.php?u=") > -1) ? usernameHolder.textContent : "%noinfo%";
				this.postsInfo += pcExtract[1] + ":" + pageNo + ":" + pcExtract[2] + ":" + username + ",";
				//quoteAnchors = page.querySelectorAll("#post" + pcExtract[1] + " p.cita>a");
			};
		};

		for (var i = 0, inspectElm, postNo, quotingPostId, postCountAnchor; inspectElm = quoteAnchors[i]; i++) {
			quotingPostId = false;
			postNo = (strTester = inspectElm.getAttribute('href')) && (strTester = strTester.match(anchorRex)) && strTester[1];
			if (postNo) {
				quoterInfo = "";
				if (!this.quotedList[postNo])
					this.quotedList[postNo] = [];
				while ((inspectElm = inspectElm.parentNode) && !quotingPostId) {
					quotingPostId = (inspectElm.id && inspectElm.id.match(postIdRex)) ? inspectElm.id.match(postIdRex)[1] : false;
				};

				if (quotingPostId && ((!this.quotedList[postNo][3]) || this.quotedList[postNo][3].indexOf(quotingPostId + ",") == -1)) {
					postCountAnchor = page.getElementById("postcount" + quotingPostId);
					//quoterInfo = quotingPostId + ":" + pageNo + ":" + ((postCountAnchor != null && postCountAnchor.name) ? postCountAnchor.name : 0) + ","; changed to: (will be as simple as just quoting post id as all list request will come back to background.js)
					quoterInfo = quotingPostId + ",";

					if (!this.quotedList[postNo][0]) {
						matcher = this.postsInfo.match(RegExp("\\b" + postNo + ":(\\d+):(\\d+)"));
						this.quotedList[postNo][0] = (matcher) ? matcher[1] : 0;
						this.quotedList[postNo][1] = (matcher) ? matcher[2] : 0;
					};
					this.quotedList[postNo][2] = (this.quotedList[postNo][2]) ? ++this.quotedList[postNo][2] : 1; //dev note - to do: this could be streamlined, as this portion was moved from a separate function. This function now can work directly on the entire data set instead of just the page's data, so this merge should be made redundant.
					this.quotedList[postNo][3] = (this.quotedList[postNo][3]) ? this.quotedList[postNo][3] + quoterInfo : quoterInfo; //dev note - to do: this could be streamlined, as this portion was moved from a separate function. This function now can work directly on the entire data set instead of just the page's data, so this merge should be made redundant.

				};
			};
		};

		var nextPageLink = page.querySelector(".pagenav a[rel=next]"),
		nextPageURL = nextPageLink && (strTester = nextPageLink.getAttribute('href')) && ((strTester.match(absURIRex) && strTester) || ((strTester.match(relURIRex) && (rootURI + strTester))) || (baseURI + strTester));

		chrome.runtime.sendMessage(null, {
			action: "popupUIcommand_displayProgress",
			targetTab: this.activeTabId,
			threadId: this.threadId,
			pageNo: this.curPage,
			lastPage: this.lastPage,
			analyzeStartPage: this.analyzeStartPage,
			status: this.status
		});

		if (settings.cachepages && this.activeTabId) //dev note: up until this point this.activeTabId is already set but this may change in the future, that's why I'm keeping this extra check.
			chrome.tabs.sendMessage(this.activeTabId, {
				action: "pageCachedNotify",
				pageNo: pageNo,
				cachedPageList: (threadCachedPages[this.threadId] && threadCachedPages[this.threadId]["cachedPageList"]) || false  //there's no way threadCachedPages for this thread id is not there at this point, checking just in case.
			});


		if (nextPageURL)
			this.loadURL(nextPageURL);
		else {
			chrome.alarms.create("analysisCacheRemove:" + this.threadId, {
				delayInMinutes: settings.analysiscachetimelimit * 1
			})
			this.status = "Analysis completed";
			chrome.runtime.sendMessage(null, {
				action: "popupUIcommand_analyzeComplete",
				targetTab: this.activeTabId
			});
			if (this.activeTabId) {
				chrome.tabs.sendMessage(this.activeTabId, {
					action: "analyzeComplete",
					populatePage: settings.populatepages
				});
			};
		};

	},

	handleError: function (err) {
		if (err.page) {
			this.loadError.push(err.page);
		}

		if (!(this.tolerance--) || err.fatalError) {
			this.status = (err.type == "DOM") ? "Aborted: bad page structure" : "Aborted: load errors";
			chrome.runtime.sendMessage(null, {
				action: "popupUIcommand_error",
				message: this.status,
				targetTab: this.activeTabId
			});
			this.abort = true;
		};
		return false;
	}

}

function inspectTab(event) {
	var threadExtract;
	if (threadExtract = event.url.match(/https?:\/\/.*\.?neogaf\.com\/.*showthread.php\?.*/))
		chrome.pageAction.show(event.tabId);
};

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {

	var thread = request.threadId && threadData[request.threadId] || false,
	cachedPointer = thread && threadCachedPages[thread.threadId] || false;
	request.tabId = request.tabId || (sender.tab && sender.tab.id) || false;

	if (request.action == "sendSettings") {
		chrome.runtime.sendMessage(null, {
			action: "popupUIcommand_applysettings",
			settings: settings
		});
		return;
	};

	if (request.action == "populatePage") {
		if (!thread) {
			sendResponse(false);
			return;
		};
		var quotedInfo = [];
		request.postIdList.forEach(function (postId) { if (thread.quotedList[postId]) quotedInfo.push([postId, thread.quotedList[postId][2]]) });
		sendResponse(quotedInfo);
	}

	if (request.action == "receiveSettings") {
		for (var key in request.settings) { //accommodate for partial sending of settings
			settings[key] = request.settings[key];
		}
		if (!settings.cachepages) {
			threadCachedPages = {};
			if (request.tabId)
				chrome.tabs.sendMessage(request.tabId, {
					action: "clearNavigation"
				}); //we need to remove cached pages from navigation lists
		};
		if (!request.saved)
			chrome.storage.sync.set(settings); //not yet using the callback;
		return;
	};

	if (request.action == "popupUIcommand_setThreadInfo") { //this is also received by the popup to set current / last pages

		if (thread)
			thread.activeTabId = request.tabId;

		if (thread && settings.cachepages && cachedPointer)
			chrome.tabs.sendMessage(request.tabId, {
				action: "pushCachedPageList",
				cachedPageList: cachedPointer["cachedPageList"]
			});

		chrome.runtime.sendMessage(null, {
			action: "popupUIcommand_displayThreadStatus",
			targetTab: request.tabId,
			status: (thread && thread.status) || "Ready for analysis"
		});

		sendResponse({ populatePage: settings.populatepages && thread && thread.status == "Analysis completed" });

		return;
	};

	if (request.action == "abortAnalyze" && thread) {
		thread.abort = true;
		if (settings.cachepages)
			chrome.tabs.sendMessage(request.tabId, {
				action: "clearNavigation"
			}); //we need to remove cached pages from navigation lists
		return;
	};

	if (request.action == "clearThreadData" && thread) {
		if (thread && thread.status !== "Analysis in progress") {
			threadData[thread.threadId] = new threadSetup("Ready for analysis", thread.threadId);
			thread = null;
			// we now treat the page caches separately from analysis cache
			// if (settings.cachepages)
			// chrome.tabs.sendMessage(request.tabId, {
			// action : "clearNavigation"
			// }); //we need to remove cached pages from navigation lists
			chrome.runtime.sendMessage(null, {
				action: "popupUIcommand_displayThreadStatus",
				targetTab: request.tabId,
				status: "Cleared analysis cache"
			});
		};
		return;
	};

	if (request.action == "refreshPageCache") {
		if (!thread || !cachedPointer || !cachedPointer["page" + request.pageNo]) {
			sendResponse({
				error: true
			});
			return;
		};
		thread.loadPage({
			pageNo: request.pageNo,
			tabId: request.tabId
		})
		return;
	};
	if (request.action == "requestPageForNavigation" || request.action == "requestPageForPostLoad") {
		if (!thread || !cachedPointer || !cachedPointer["page" + request.page]) {
			sendResponse({
				error: true
			});
			return;
		};

		chrome.alarms.create("pageCacheRemove:" + thread.threadId, {
			delayInMinutes: settings.pagecachetimelimit * 1
		});
		sendResponse({
			action: "cachedPageResponse",
			pageHTMLstring: cachedPointer["page" + request.page],
			cacheTime: cachedPointer["pagetime" + request.page],
			cachedPageList: cachedPointer["cachedPageList"],
		});
		return;
	};

	if (request.action == "startAnalyze") {
		if (thread && thread.status == "Analysis in progress")
			return; //safety valve;

		if (!thread) {
			threadData[request.threadId] = new threadSetup("Analysis in progress", request.threadId);
			thread = threadData[request.threadId];
		};
		thread.baseURL = request.url;
		thread.activeTabId = request.tabId;
		thread.analyzeStartPage = request.curPage;
		thread.lastPage = request.lastPage;
		thread.threadTitle = request.threadTitle;
		thread.loadURL(request.url + "&page=" + request.curPage);
		return;
	};

	//if (request.action == "keepalive" && thread) {//this may not be needed after I change to infinite reply list mode.
	//	chrome.alarms.create("analysisCacheRemove:" + thread.threadId, {
	//		delayInMinutes: settings.analysiscachetimelimit * 1
	//	});
	//	return;
	//};

	if (request.action == "displayResults" && thread) {
		chrome.alarms.create("analysisCacheRemove:" + thread.threadId, {
			delayInMinutes: settings.analysiscachetimelimit * 1
		});

		if (cachedPointer) chrome.alarms.create("pageCacheRemove:" + thread.threadId, {
			delayInMinutes: settings.pagecachetimelimit * 1
		});

		request.cachedPageList = cachedPointer && cachedPointer["cachedPageList"];


		var listUsers = (settings.followuser && settings.followuser != "") ? settings.followuser.split(",") : false,
		threshold = parseInt(settings.threshold) || 1,
		nameFind,
		userPosts,
		userPostList = [];

		request.inPagePostCounts = {}; //holds page counts in the following format: {page1: noOfFilteredPostsInPage, page2: noOfFilteredPostsInPage, ...}
		//this is used by the show result routines to know exactly when to remove the cached page from memory for displaying post results from cache.
		request.ordertype = settings.ordertype; //dev note: ordering can be done inside the background.js
		request.threshold = threshold;
		request.threadTitle = thread.threadTitle;

		if (listUsers) {
			listUsers.forEach(function (user) {
				nameFind = new RegExp("\\d*:\\d*:\\d*:" + user.trim() + ",", "gi")
				if (userPosts = thread.postsInfo.match(nameFind)) {
					userPostList = userPostList.concat(userPosts.map(function (postInfo) {
						var partialInfo = postInfo.split(":"),
						restInfo = thread.quotedList[partialInfo[0]] || [],
						pageCount = request.inPagePostCounts["page" + partialInfo[1]] || 0;
						request.inPagePostCounts["page" + partialInfo[1]] = ++pageCount;
						return [partialInfo[0], partialInfo[1], partialInfo[2], restInfo[2] || false, true];
						//syntax : [postId,pageNumber,postCount,numberOfTimesQuoted,quotersList,followedUser] changed to:
						//syntax : [postId,pageNumber,postCount,numberOfTimesQuoted,followedUser]
					}));
				};
			});

		};

		request.postList = userPostList.concat(Object.keys(thread.quotedList).filter(function (postId) {
			return thread.quotedList[postId][2] >= threshold;
		}).map(function (postId) {
			var postAr = thread.quotedList[postId].slice(0, 3),
			pageCount = request.inPagePostCounts["page" + postAr[0]] || 0;
			request.inPagePostCounts["page" + postAr[0]] = ++pageCount;
			return [postId].concat(postAr);
		}));

		request.topLevel = true;
		chrome.tabs.sendMessage(request.tabId, request);
		return;
	};

	if (request.action == "listQuotingPosts" && thread) {
		chrome.alarms.create("analysisCacheRemove:" + thread.threadId, {
			delayInMinutes: settings.analysiscachetimelimit * 1
		});

		if (cachedPointer) chrome.alarms.create("pageCacheRemove:" + thread.threadId, {
			delayInMinutes: settings.pagecachetimelimit * 1
		});

		var quotedPost = thread.quotedList[request.postId] || false;

		if (!quotedPost)
			return false; //quotedPost is false when thread analyse data is cleared.
		request.inPagePostCounts = {}; //holds page counts in the following format: {page1: noOfFilteredPostsInPage, page2: noOfFilteredPostsInPage, ...}
		request.ordertype = settings.ordertype;
		request.postList = quotedPost[3].split(',').map(function (postId) {
			var matcher,
			idFind = new RegExp(postId + ":\\d*:\\d*:.*?,", "gi"); //dev note: grabbing also that user name to mark followed users later on, make sure slice(0,-1)

			if (matcher = (postId != "") && thread.postsInfo.match(idFind)) {
				var partialInfo = matcher[0].split(':'),
				restInfo = thread.quotedList[partialInfo[0]] || [],
				pageCount = request.inPagePostCounts["page" + partialInfo[1]] || 0;
				request.inPagePostCounts["page" + partialInfo[1]] = ++pageCount;
				return [partialInfo[0], partialInfo[1], partialInfo[2], restInfo[2] || false]; //may later add the followed user boolean as the last array item.
			};
			return false;
		}).filter(function (postInfo) {
			return postInfo
		}); //this filters out the ones that matcher can't find info for.
		chrome.tabs.sendMessage(request.tabId, request);
		return;
	}

});
