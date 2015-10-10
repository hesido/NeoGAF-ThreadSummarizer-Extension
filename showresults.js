// NeoGAF Thread Summarizer Copyright (c) 2015 hesido.com
"use strict";

//done: Cached navigation
//done: remove background.window object references in popup.js
//done: click handlers no longer to use closures
//done: Re-display results without re-load
//done: add basic cache settings on popup

//done: aggressive removal of cached pages to reduce mem usage (remedy the increased mem usage introduced by "use cached pages for post retrieval")
//done: settings are stored, synced
//done: fix behaviour that causes separate quotes of the same post in the same quoting post to be counted multiple times
//done: better behaviour when re-analysing already analyzed threads
//done: time limit assigned for auto removal of cached pages
//done: separate options page
//done: optionally use cache when re-analyzing (except last page analyzed)
//done: infinite recursive post display
//done: collapse quoters properly in recursive fashion
//done: fix: re-analysis broken after recursive post display
//done: fix: re-displaying analysis results is buggy
//done: manual refresh page to update caches

//partially done: fix memory leaks - extensions memory leaks patched. Memory leak due to neogaf html may be fixed later
//to do: tab handling (Keep record of all open neogaf.com thread tabs and send them notifications when cache is removed / stale)
// OR
//better handling of errors cache is removed but requests are made from tabs 

//to do: Populated pages should update with updated analysis
//to do: Completely unify first displayJob, recursed displayJob, and populated displayJobs to use the same code path.
//to do: fragment error handling could be done better;
//to do: proper representation of recursion (too many recursions will make the content very narrow)
//to do: show results page in navigation history (hitting back and forward should take you to the results display)

//to do: auto refresh pages visited to reflect any changes (may not be possible in a transparent manner without re-downloading page)

//to do: dedicated button to delete all thread analyse cache
//to do: cached page limit setting with dynamic caching
//to do: display a basic graph about quoted posts
//to do: do reply tracking on a post by post basis instead of inside a thread using contextual menu. May be used to track replies to specific posts in post search results.
//to do: kick start analysis from forum thread list pages using contextual menus
//to do: Cached navigation with animation -> not a priority.,
//to do: animated collapse

//to do: break showresults into separate files to lessen memory impact, load / execute only necessary files.

//these could be enlosed to prevent touching the globals, but since extensions run in their own environment it's not necessary.
var postContainer,
tabId,
threadId, // this is set by threadInfo() on request from popup.js and in popstate;
// mainDisplayJob = null,
threadTitle,
MAX_SIMULTANEOUS_POST_LOADS = 8, //variables that can be transferred to options page are capitalized.
//MIN_QUOTE_TRESHOLD = 2,
MIN_WAIT_BEFORE_APPEND = 40, //milliseconds to wait for the next post load before appending it to page.
CACHE_PAGES = false, //will be set to true if background page does a "pushCachedPageList"
allowedConnectionPool = MAX_SIMULTANEOUS_POST_LOADS,
docReady = false,
cachedPageList = ",",
parsedPages = {},
cacheQueue = {}, // {page1:[],page2:[]...};
displayJobs = {}, // settings things ready for recursive displays.
curPage = false, //we need this in the refresh page function
populatePage = false, //this will be set after thread id is sent over
pagePopulated = false,
loadAnim = false,
refreshAnim;


if (document.readyState == "interactive" || document.readyState == "complete")
	setup();
else
	document.addEventListener("DOMContentLoaded", setup);

chrome.runtime.onMessage.addListener(triage);

function handleHistory(event) {
	threadId = threadId || threadInfo();
	var page = event.state && event.state.gafEnhancePopState_page;
	if (page && threadId) {
		chrome.runtime.sendMessage(null, {
			action : "requestPageForNavigation",
			threadId : threadId,
			page : page
		}, function (response) {
			if (response.error) {
				window.location.href = document.URL;
				return;
			};
			displayCachedPage(response);
		});
	};
};

function setup() {
	if (!threadInfo())
		return;

	postContainer = document.getElementById("posts");
	docReady = true;

};

function triage(request) {

	if (request.action == "pageInfoAnalyse") {
		if (docReady)
			threadInfo();
		else
			document.addEventListener("DOMContentLoaded", threadInfo);
		return;
	};

	if (!docReady) {
		chrome.runtime.sendMessage(null, {
			action : "popupUIcommand_error",
			message : "Page not yet ready",
			targetTab : tabId
		});
		return false;
	};

	populatePage = populatePage || request.populatePage || false;

	if (request.action == "analyzeComplete" && !pagePopulated && populatePage)
		doPagePopulate();

	if (request.action == "displayResults")
		showResults(request);

	if (request.action == "listQuotingPosts") {
		displayJobs[request.quotedId + "_job"] = new SetupDisplay(request);
		displayJobs[request.quotedId + "_job"].begin(); //maybe we need to stop using begin() and have it auto-initiate;
	};

	if (request.action == "pageCachedNotify") {
		setCachedLink(request.pageNo);
		if (!CACHE_PAGES)
			window.addEventListener('popstate', handleHistory);
		CACHE_PAGES = true;
	};

	if (request.action == "resreshPageResponse") {
		// refreshAnim.breakLoop("gaf_enhance_extension_refreshcache");
		refreshAnim.remove();
		refreshAnim = null;
		displayCachedPage(request);
	}

	// if (request.action == "cachedPageResponse") {
	// displayCachedPage(request);
	// }

	if (request.action == "clearNavigation")
		clearNavigation();
		
	if (request.action == "newPostsArrived")
		newPostNotify(request.noOfPosts);
};

function newPostNotify(newPostCount) {
	
	var newPostNotes = document.querySelectorAll("a.gaf_enhance_extension_newpost");
	if(newPostNotes.length == 0) {
		insertNewPostNote();
		newPostNotes = document.querySelectorAll("a.gaf_enhance_extension_newpost");
	}

	for (var i = 0, anch; anch = newPostNotes[i]; i++) {
		flashElement(anch);
		anch.textContent = newPostCount + " new post" + ((newPostCount > 1)? "s" : "");
		window.setTimeout(flashElement.bind(anch),66);
	}
}

function flashElement(elm){
	if(elm) {
		elm.classList.add("supressanim");
		elm.classList.remove("active");
		} else {
	this.classList.remove("supressanim");
    this.classList.add("active");
		}
}

function insertNewPostNote() {
	var insertTargets = document.querySelectorAll("ul.pagenav");
	if (insertTargets.length == 0) {
		var insertTargetParents = document.querySelectorAll("div.clearfix:not(.tcat)>div.right");
		if(insertTargetParents.length == 0) return;
		for (var i = 0, insertTargetParent; insertTargetParent = insertTargetParents[i]; i++) {
			insertTargets[i] = document.createElement("ul");
			insertTargets[i].classList.add("pagenav");
			insertTargetParent.appendChild(insertTargets[i]);
		}		
	}; //insertTargets[0] = document.querySelector("div.right");
	//if (insertTargets[0] == null) return;
	var toInsert, anch;

	//toInsert.classList.add("gaf_enhance_extension_newpost");
	
	for (var i = 0, insertionPoint; insertionPoint = insertTargets[i]; i++) {
		toInsert = document.createElement("li");
		anch = document.createElement("a");
		anch.classList.add("gaf_enhance_extension_newpost");
		anch.href = "#"
		toInsert.appendChild(anch);
		anch.addEventListener("click", cacheLink, false);	
		if(insertionPoint.firstElementChild!==null)
			insertionPoint.insertBefore(toInsert,insertionPoint.firstElementChild)
		else
			insertionPoint.appendChild(toInsert);
	}
}

function displayCachedPage(request) {

	var parser = new DOMParser(),
	parsed = parser.parseFromString(request.pageHTMLstring, "text/html"),
	mins = Math.ceil(((new Date()).getTime() - request.cacheTime) / 1000 / 60),
	newPageContent,
	pageContent,
	contentwrapper,
	title;

	if ((newPageContent = parsed.getElementById('main')) && (pageContent = document.getElementById("main"))) {
		pageContent.parentNode.replaceChild(newPageContent, pageContent);
		postContainer = document.getElementById('posts');
		if (contentwrapper = document.getElementById("container"))
			contentwrapper.scrollIntoView(true); // dev: animating this could be a good idea. Maybe leveraging the fleXanim library for this by modifying could be nice.
		// postContainer.scrollIntoView(true);
	}; // dev note: some error handling could be fine here


	if (title = document.querySelector('div.tcat div.left')) {

		var tempHolder = document.createDocumentFragment(),
		textHolder = document.createElement("span"),
		refreshAnc = document.createElement("a");

		textHolder.classList.add("gaf_enhance_extension_cachedinfo");
		refreshAnc.id = "gaf_enhance_extension_refreshcache";
		textHolder.textContent = " (cached ~" + mins + " minute" + ((mins > 1) ? "s" : "") + " ago) ";
		refreshAnc.textContent = "[Refresh contents]";

		//refreshAnc.setAttribute("data-gafenhancepageno", pageNo);
		refreshAnc.addEventListener("click", refreshPage, false);
		tempHolder.appendChild(textHolder);
		tempHolder.appendChild(refreshAnc);
		title.appendChild(tempHolder);

	};

	// if ((parsedNavigationList = parsed.querySelector('ul.pagenav')) && (navigationLists = document.querySelectorAll('ul.pagenav'))) {
	//	tempHolder.appendChild(parsedNavigationList); //dev note: after onclick handling is passed to the document object instead of anchors, do the modifications inside the fragment instead of after attaching to DOM.
	//	for (var i = 0, navUL; navUL = navigationLists[i]; i++) {
	//		navUL.parentNode.replaceChild(tempHolder.cloneNode(true), navUL);
	//	};
	// }; //dev note: some error handling could be fine here
	pagePopulated = false;
	threadInfo();
	resetNavigation();
	if(request.postId) window.location.hash = "post"+request.postId;
};

function threadInfo() {
	var matchedURL,
	threadIdExtract,
	threadTitle,
	curPageExtract,
	//curPage, //globalised
	lastPageExtract,
	lastPage,
	domainPrefix = "www.",
	//baseURIRex = /(.*\/).*$/, //use matchedurl and replace domainPrefix with baseURI capture
	pageRex = /(?:\?|&)page=(\d+)/;

	if (!(matchedURL = document.URL.match(/https?:\/\/(.*\.?)neogaf\.com\/.*showthread.php\?.*/)))
		return false;

	threadId = matchedURL[0].match(/(?:\?|&)t=(\d+)/);
	threadId = threadId && threadId[1];
	curPage = matchedURL[0].match(pageRex);
	curPage = curPage && curPage[1];
	domainPrefix = matchedURL[1];

	threadIdExtract = document.getElementsByName("searchthreadid")[0] || false;
	threadId = threadId || (threadIdExtract && threadIdExtract.value);
	if (threadTitle = document.querySelector("#main div.tcat div.left a"))
		threadTitle = threadTitle.textContent;
	curPageExtract = document.querySelector("ul.pagenav li.current span") || false;
	curPage = curPage || (curPageExtract && curPageExtract.textContent.trim());
	curPage = (!isNaN(curPage) && curPage) || 1;
	lastPageExtract = document.querySelector("ul.pagenav li.last a") || false;
	lastPage = (lastPageExtract && lastPageExtract.href && lastPageExtract.href.match(pageRex));
	lastPage = lastPage && lastPage[1];

	if (!lastPage) {
		lastPage = 1;
		lastPageExtract = document.querySelectorAll("ul.pagenav a");
		var anchor,
		pageNo = 1,
		pageExtract;
		for (var i = 0; anchor = lastPageExtract[i]; i++) {
			pageNo = anchor.href && (pageExtract = anchor.href.match(pageRex)) && pageExtract[1] || pageNo;
			lastPage = Math.max(lastPage, pageNo);
		};
		lastPage = Math.max(curPage, lastPage);
	};
	
	lastPage = parseInt(lastPage);

	if (!threadId) {
		chrome.runtime.sendMessage(null, {
			action : "popupUIcommand_error",
			message : "Cannot determine thread number. Aborting process.",
			targetTab : null //this is a message that cannot be displayed because popup.js looks for a matching targetTab value. Will take care of this later.
		});
		return;
	};

	chrome.runtime.sendMessage(null, {
		action : "popupUIcommand_setThreadInfo",
		threadId : threadId,
		url : "http://" + domainPrefix + "neogaf.com/forum/showthread.php?t=" + threadId,
		//url: "http://" + domainPrefix + "neogaf.com/forum/showthread.php?t=" + threadId + "&page=" + curPage,
		//			urlPrefix: domainPrefix,
		curPage : curPage,
		lastPage : lastPage,
		threadTitle : threadTitle
	}, function (response) {
		//dev - populate page: this will get an answer as to whether the page should be populated.
		populatePage = response.populatePage;
		if (!pagePopulated && populatePage) doPagePopulate();
		if (response.cachedPageList) {
			cachedPageList = response.cachedPageList;
			//cachedPageList = request.cachedPageList;
			if (!CACHE_PAGES)
				window.addEventListener('popstate', handleHistory);
			CACHE_PAGES = true;
			resetNavigation();
		}
		return;
	});

	history.replaceState({
		gafEnhancePopState_page : curPage,
		gafEnhancePopState_title : document.title
	}, null, null);

	return threadId;
};

function doPagePopulate() {
	if(pagePopulated) return; //safety valve
	pagePopulated = true; //currently updates to existing populated links are not possible.
	var postCTAnchors = document.querySelectorAll("a[id^='postcount']"),
		rexer = /showpost.php\?p=(\d+)&postcount=/,
		postIdList = [];

	for (var i = 0, anchor, strTester; anchor = postCTAnchors[i]; i++) {
		strTester = (strTester = anchor.getAttribute('href')) && (strTester = strTester.match(rexer)) && strTester[1];
		postIdList.push(strTester);
	};
	
	chrome.runtime.sendMessage(null, {
		action: "populatePage",
		threadId: threadId,
		postIdList: postIdList
	}, function (response) {
		if (!response) {
			return;
		};
		response.forEach(function (quotedInfo) {
			var postDiv = document.getElementById("post" + quotedInfo[0]);
			if (postDiv === null) return;
			var span = postDiv.querySelector("#post"+quotedInfo[0]+" div.post-meta span.right");
			if (span != null) {
				addQuotedInfo(span, quotedInfo[1], quotedInfo[0], true);
			};
		});
	});

}

function resetNavigation() {
	if (!cachedPageList)
		return;
	cachedPageList.split(",").forEach(function (pageNo) { //currently checked once for each cached page. for reset navigation, it should be the other way around.
		if (pageNo !== "")
			setCachedLink(pageNo);
	});
}

function setCachedLink(cachedPageNo) {
	var anchors = document.querySelectorAll("ul.pagenav a:not(.gaf_enhance_extension_newpost)"),
	anchor,
	pageNo,
	pageExtract,
	pageRex = /(?:\?|&)page=(\d+)/;

	// if (cachedPageList.indexOf("," + cachedPageNo + ",") < 0) cachedPageList += cachedPageNo + ",";

	for (var i = 0; anchor = anchors[i]; i++) {
		pageNo = anchor.href && (((pageExtract = anchor.href.match(pageRex)) && pageExtract[1]) || (anchor.href.match(/https?:\/\/.*\.?neogaf\.com\/.*showthread.php\?.*/) && 1));
		if (pageNo && pageNo == cachedPageNo) {
			//		anchor.href = "#";
			anchor.setAttribute("data-gafenhancepageno", pageNo);
			anchor.classList.add("gaf_enhance_extension_cached");
			anchor.addEventListener("click", cacheLink, false);
		}; //dev note: some animation would be nice.
	};

	// if (!dontModifyList)
	// cachedPageList += cachedPageNo + ","; //this may be obsolete
};

function refreshPage() {
	//gaf_enhance_extension_cachedinfo
	if (!curPage || refreshAnim)
		return; //dev note: there's probably no way curPage is not set by the time this gets executed, but who knows.

	displayJobs = {}; //zap display jobs - previously not needed as normal pages weren't populated by the extension.

	refreshAnim = new LoadingAnim("#gaf_enhance_extension_refreshcache")

	chrome.runtime.sendMessage(null, {
		action : "refreshPageCache",
		threadId : threadId,
		pageNo : curPage
	}, function (response) {
		if (response.error) {
			refreshAnim.remove();
			refreshAnim = null;
			// refreshAnim.breakLoop("gaf_enhance_extension_refreshcache");
			window.location.href = document.URL;
			return;
		};
	});
};

function cacheLink(e) {
	var clickedPage = this.getAttribute("data-gafenhancepageno") || false,
	href = this.href;

	displayJobs = {}; //zap previous jobs // this may later have to be solved in an elegant way allowing for collapse state preserving browser history events.

	chrome.runtime.sendMessage(null, {
		action : "requestPageForNavigation",
		threadId : threadId,
		page : clickedPage
	}, function (response) {
		if (response.error) {
			window.location.href = href;
			return; //add document url change here.
		}
		//dev - populate page: this will get an answer as to whether the page should be populated.
		href = response.pageURL;
		history.pushState({
			gafEnhancePopState_page : response.page
		}, null, href);
		displayCachedPage(response);
	});
	e.preventDefault();
	return false;
};

function clearNavigation() {
	var toClear = document.querySelectorAll("ul.pagenav a.gaf_enhance_extension_cached"),
	anchor;
	//titleSpan = null;

	for (var i = 0; anchor = toClear.item(i); i++) {
		anchor.classList.remove("gaf_enhance_extension_cached");
		anchor.removeEventListener("click", cacheLink, false);
	};
	cachedPageList = ",";
	parsedPages = {};
};

function showResults(request) {
	if (!postContainer) {
		chrome.runtime.sendMessage(null, {
			action : "popupUIcommand_error",
			message : "Page structure error. Cannot continue.",
			targetTab : tabId
		});
		return;
	};

	if (request.postList) {

		var threshold = parseInt(request.threshold) || 1,
		titleSpan;
		tabId = request.tabId;
		var title = document.querySelector("#main.content .tcat .left");
		// var title = document.querySelector("#main.content .tcat .left span");
		// if (title) title.textContent = "Thread summary: Displaying posts that are quoted at least " + threshold + " time" + ((threshold > 1) ? "s" : "") + ".";
		if (title) {
			titleSpan = document.createElement("span");
			titleSpan.textContent = "Analysis display for thread: " + request.threadTitle;
		};

		postContainer.style.display = "none";
		postContainer.classList.add("gaf_enhance_extension_active");
		while (postContainer.firstChild) {
			postContainer.removeChild(postContainer.firstChild);
		}

		if (title) {
			while (title.firstChild) {
				title.removeChild(title.firstChild);
			};
			title.appendChild(titleSpan);
		} //to avoid redraw, node changes are made consecutively.

		postContainer.style.display = "block";

		initAnim();

		displayJobs = {}; //zap previous jobs // this may later have to be solved in an elegant way allowing for collapse state preserving browser history events.
		displayJobs["maindisplayjob"] = new SetupDisplay(request);
		displayJobs["maindisplayjob"].begin();
		// mainDisplayJob.begin();

	};
};

function initAnim() {
	if (loadAnim) return;
	loadAnim = new $fleXanim.Prepare();
	loadAnim.setAnimation({
		template: "backgroundColor:RGB(##,##,##)",
		startVal: [73, 130, 174],
		endVal: [200, 200, 220],
		frames: 20
	}).setAnimation({
		template: "backgroundColor:RGB(##,##,##)",
		endVal: [73, 130, 174],
		frames: 20
	}).loop().clearAnim();
}

function LoadingAnim(selector) {
	var appendAfter = document.querySelector(selector);
	if (!appendAfter) return;
	var	appendPoint = appendAfter.nextElementSibling || false;
	this.span = document.createElement("span"),
	this.span.classList.add("gaf_enhance_extension_loading");
	if (appendPoint) appendPoint.parentNode.insertBefore(this.span, appendPoint);
	else appendAfter.parentNode.appendChild(this.span);
};

LoadingAnim.prototype = {
	remove:function() {
		if(!this.span) return false; //for cases when selector fails.
		this.span.parentNode.removeChild(this.span);
		this.span = null;
	}
};

function SetupDisplay(request) {
	// var dataSource = request.quotedInfo || false,
	var threshold = parseInt(request.threshold) || 1;

	this.parentJobId = request.parentJobId || false;
	this.preAppendFragment = document.createDocumentFragment();
	//this.postList = request.postList || false; //changed to:
	this.postList = request.postList; //as there will now always be a post list.
	this.postHolder = this.preAppendFragment.appendChild(document.createElement("div"));

	this.followedSpan = document.createElement("span");
	this.followedSpan.classList.add("gaf_enhance_extension_followed");
	this.followedSpan.textContent = "Followed User";

	this.inPagePostCounts = request.inPagePostCounts || {};
	this.indexPoint = 0;
	this.loadError = []; //array that holds index points that has load errors.
	this.quoteDisplay = {};
	this.idList = [];
	this.childJobList = [];
	this.lastAppendIndex = 0;
	this.appendTimeout = false;
	this.pollTimeout = false;
	this.requestTimeout = false;
	this.abort = false; //abort when tolerance is exhausted
	this.maxLocalLoads = 5; // maximum number of simultaneous connections, local to object.
	this.localConnectionPool = 5; // number of simultaneous connections, local. Should be equal to maxLocalLoads
	this.tolerance = 6; //max number of errors before stopping operation


	if (!this.parentJobId) {

		this.jobId = "maindisplayjob";
		this.postHolder.id = "gaf_enhance_extension_posts";
		this.postHolder.classList.add("gaf_enhance_extension_posts_quoted-holder");
		this.infoBar = this.postHolder.appendChild(document.createElement("div"));
		this.infoBar.textContent = "Thread summary: Displaying posts by followed users or that are quoted at least " + threshold + " time" + ((threshold > 1) ? "s" : "") + ".";
		this.infoBar.id = "gaf_enhance_extension_threadinfo";
		this.loadAnimElmId = this.infoBar.id;

		var appendStub = this.postHolder.appendChild(document.createElement("div")); //this stub ensures there's a next element sibling for quoter-holder
		appendStub.id = "gaf_enhance_extension_stub";

		postContainer.appendChild(this.preAppendFragment);

		// this.postList = Object.keys(dataSource.quotedList).filter(function (postId) {
		// return dataSource.quotedList[postId][1] >= threshold
		// }).map(function (postId) {
		// return [postId].concat(dataSource.quotedList[postId])
		// });

	} else {
		this.jobId = request.quotedId + "_job";
		//		displayJobs[this.parentJobId].childJobList.push(this.jobId);
		if (displayJobs[this.parentJobId]) displayJobs[this.parentJobId].childJobList.push(this.jobId); //we now have to check whether there's actually a parent Job, because it will not be present for auto-populated pages.
		this.loadAnimElmId = "gaf_enhance_extension_quoters" + this.jobId;
		this.postHolder.id = this.loadAnimElmId;
		this.postHolder.classList.add("gaf_enhance_extension_posts_quoter-holder");

		var quotedDiv = document.getElementById(request.quotedId);
		var collapseButton = this.postHolder.appendChild(document.createElement("span"));
		collapseButton.classList.add("gaf_enhance_extension_collapse");
		collapseButton.setAttribute("title", "Collapse posts");
		collapseButton.setAttribute("data-gafenhancejobid", this.jobId);
		collapseButton.addEventListener("click", collapsePosts, false); //this will have to be handled properly for recursive quotes

		quotedDiv.parentNode.insertBefore(this.preAppendFragment, quotedDiv.nextElementSibling);
	};

	// postList syntax: [postId,postCount,numberOfTimesQuoted,followedUser]

	this.postTotal = this.postList.length;
	this.processedPosts = 0;

	if (request.ordertype == 1) { //dev note: as a programming exercise, this could be made to do sorts based on multiple criteria with different priorities.
		this.postList.sort(function (a, b) {
			// return b[3] - a[3];
			return (b[4] && !a[4]) ? 1 : ((b[4] && a[4]) || (!b[4] && !a[4])) ? b[3] - a[3] : -1;
			//followed users first
		});
	} else {
		this.postList.sort(function (a, b) {
			return (b[4] && !a[4]) ? 1 : ((b[4] && a[4]) || (!b[4] && !a[4])) ? a[2] - b[2] : -1;
		});
	};
};

SetupDisplay.prototype = {

	begin : function () {
		//		loadAnim.init(this.loadAnimElmId); //make sure we reset to the first animation key as this may be called multiple times for the same reference.
		initAnim();
		loadAnim.animate(this.loadAnimElmId);
		if (this.postList.length == 0) {
			if (this.infoBar)
				this.infoBar.textContent = "No posts match threshold or no posts by followed users. Try with a lower quote threshold.";
			this.stopAllActivity();
		} else
			this.requestNextBatch();
	},

	requestNextBatch : function () {
		if (this.abort) {
			this.stopAllActivity();
			return false;
		};
		var orderStub,
		poolUsed = false;
		if (this.pollTimeout)
			window.clearTimeout(this.pollTimeout);
		this.pollTimeout = false;
		while (allowedConnectionPool && this.localConnectionPool && this.postList[this.indexPoint]) {
			orderStub = this.preAppendFragment.appendChild(document.createElement("div"));
			orderStub.id = "gee_orderstub" + this.indexPoint;
			orderStub.classList.add("gee_stub");
			this.loadPost(this.indexPoint);
			//this.indexPoint++;
			poolUsed = true;
		};
		if (!poolUsed && this.postList[this.indexPoint]) {
			this.pollForPool()
		};
	},

	pollForPool : function () {
		if (this.pollTimeout)
			window.clearTimeout(this.pollTimeout);
		this.pollTimeout = window.setTimeout(this.requestNextBatch.bind(this), 300);
		// wait 300 ms for next pool check
	},

	freePool : function () {
		allowedConnectionPool++;
		this.localConnectionPool++;

		if (this.appendTimeout)
			window.clearTimeout(this.appendTimeout);
		this.appendTimeout = window.setTimeout(this.appendToDoc.bind(this), MIN_WAIT_BEFORE_APPEND);

		if (++this.processedPosts == this.postTotal) {
			this.appendToDoc(true);
			var errorNotify = (this.loadError[0]) ? "Loading errors occurred on some posts." : "All posts are loaded properly.";
			loadAnim.breakLoop(this.loadAnimElmId);
			chrome.runtime.sendMessage(null, {
				action : "popupUIcommand_message",
				message : "Processed all posts. " + errorNotify,
				targetTab : tabId
			});
		};

	},

	stopAllActivity : function () { //dev note: may add force appendToDoc
		if (this.appendTimeout)
			window.clearTimeout(this.appendTimeout);
		if (this.pollTimeout)
			window.clearTimeout(this.pollTimeout);
		if (this.requestTimeout)
			window.clearTimeout(this.requestTimeout);
		this.requestTimeout = false;
		this.appendTimeout = false;
		this.pollTimeout = false;
		loadAnim.breakLoop(this.loadAnimElmId);
		this.abort = true;
	},

	appendToDoc : function (forced) {
		if (this.appendTimeout)
			window.clearTimeout(this.appendTimeout);
		this.appendTimeout = false;
		if (this.preAppendFragment.querySelector(".gee_stub") == null || forced) {
			this.postHolder.appendChild(this.preAppendFragment);
			this.requestNextBatch();
		} else {
			if (this.requestTimeout)
				window.clearTimeout(this.requestTimeout);
			this.requestTimeout = window.setTimeout(this.requestNextBatch.bind(this), MIN_WAIT_BEFORE_APPEND * 8);
		}
		//		this.requestNextBatch();
	},

	pushToFragment : function (postDiv, indeX) {

		var id = postDiv.id || ("gaf_enhance_extension_" + indeX),
		idRep = id,
		fragment = this.preAppendFragment,
		orderStub = fragment.getElementById("gee_orderstub" + indeX),
		anch,
		i = 0;
		while (document.getElementById(idRep) !== null || this.preAppendFragment.getElementById(idRep) !== null) {
			idRep = id + "_" + (++i);
		};
		if (idRep !== id)
			postDiv.id = idRep;

		postDiv.classList.remove("alt1");
		postDiv.classList.remove("alt2");
		postDiv.classList.add("alt" + (indeX % 2 + 1));
		if (anch = postDiv.querySelector("a.gaf_enhance_extension_lister"))
			anch.href = "#" + idRep;
		this.idList[indeX] = idRep;

		if (orderStub !== null)
			fragment.replaceChild(postDiv, orderStub);
		else
			console.log("NeoGAF Thread Summarizer: fragment error!!");

		if (this.appendTimeout)
			window.clearTimeout(this.appendTimeout);
		this.appendTimeout = window.setTimeout(this.appendToDoc.bind(this), MIN_WAIT_BEFORE_APPEND);
	},

	loadPost : function (indeX) {
		// chrome.runtime.sendMessage(null, { //keep thread analysis cache alive, postpone auto-clear. //this can be done per click instead of per post load, as now all requests go to background.js
		//	action : "keepalive",
		//	threadId : threadId
		// });
		this.indexPoint++;
		this.localConnectionPool--;
		allowedConnectionPool--;
		var postAr = this.postList[indeX], //[postNo,pageNo,postCount,timesQuoted,quoterList,followedUser(boolean)]
		cachedPost;
		if (cachedPost = this.fetchFromCache(postAr, indeX))
			return;
		self = this;

		// var urlBase = "http://www.neogaf.com/forum/showpost.php?p=";
		// if (parseInt(Math.random() * 4) + 1 > 3)
		// urlBase = "http://www.neogaf.com/forum/sghreowpost.php?p=";

		try {
			var r = new XMLHttpRequest();
			r.open("GET", "http://www.neogaf.com/forum/showpost.php?p=" + postAr[0] + "&postcount=" + postAr[2], true);
			r.responseType = "document";
			r.onerror = function () {
				//self.freePool();
				self.handleError({
					indexPoint : indeX,
					type : "load"
				})
			};
			r.onload = function () {
				var postDiv = r.response.getElementById("post" + postAr[0]);
				if (postDiv == null || self.postHolder == null) {
					self.handleError({
						indexPoint : indeX,
						type : "DOM"
					});
					return false;
				};
				self.preProcess(postDiv, postAr, indeX);
			};
			r.send(null);
		} catch (e) {
			this.handleError({
				indexPoint : indeX,
				type : "load"
			});
		};

	},

	fetchFromCache : function (postAr, indeX) {
		var postDiv,
		pageName = "page" + postAr[1],
		self = this;

		if ((cachedPageList.indexOf("," + postAr[1] + ",") > -1) && !parsedPages[pageName]) {
			cacheQueue[pageName] = cacheQueue[pageName] || [];
			cacheQueue[pageName].push([indeX].concat(postAr));
			if (!cacheQueue[pageName][1])
				chrome.runtime.sendMessage({ //request the page for only the first push-whether this approach is dependable needs to be tested.
					action : "requestPageForPostLoad",
					threadId : threadId,
					page : postAr[1]
				}, function (response) {
					var parser = new DOMParser();
					if (response.error) {
						self.handleError({
							indexPoint : indeX,
							type : "cache"
						});
						return;
					};

					parsedPages[pageName] = parser.parseFromString(response.pageHTMLstring, "text/html");
					var indNpostAr,
					postAr,
					indeX,
					postDiv;
					while (indNpostAr = cacheQueue[pageName].pop()) {
						postAr = indNpostAr.splice(1);
						indeX = indNpostAr[0];
						// pageName = indNpostAr[1];
						if (postDiv = parsedPages[pageName].getElementById("post" + postAr[0]))
							self.preProcess(postDiv, postAr, indeX);
						else
							self.handleError({
								indexPoint : indeX,
								type : "cache"
							});
						if (--self.inPagePostCounts[pageName] == 0)
							parsedPages[pageName] = null;
					};
				});
			return true;
		};
		if ((parsedPages[pageName]) && (postDiv = parsedPages[pageName].getElementById("post" + postAr[0]))) {
			this.preProcess(postDiv, postAr, indeX);
			if (--this.inPagePostCounts[pageName] == 0)
				parsedPages[pageName] = null;
			return true;
		};
		return false;
	},

	preProcess : function (postDiv, postAr, indeX) {
		var postBitDiv;
		//postAr = [postNo,pageNo,postCount,timesQuoted,quoterList,followedUser(boolean)]
		postDiv.classList.add("gaf_enhance_extension_results");
		if (postAr[3]) {
			var span = postDiv.querySelector("div.post-meta span.right");
			if (span != null) {
				addQuotedInfo(span, postAr[3], this.jobId + ":" + indeX);

		//		var anchor = document.createElement("a");
		//		anchor.textContent = "List the " + ((postAr[3] > 1) ? (postAr[3] + " posts") : "post") + " that quoted this post. ";
		//		anchor.setAttribute("data-gafenhanceindex", this.jobId + ":" + indeX);
		//		anchor.classList.add("gaf_enhance_extension_lister");
		//		anchor.addEventListener("click", displayQuoters, false);

		//		span.insertBefore(anchor, span.firstChild);
			};
		};

		if (postAr[5] && (postBitDiv = postDiv.querySelector("div.postbit-details"))) {
			postBitDiv.appendChild(this.followedSpan.cloneNode(true));
		};
		this.pushToFragment(postDiv, indeX);
		this.freePool();

	},

	handleError : function (err) {
		if (err.indexPoint) {
			this.loadError.push(err.indexPoint);
			var stub = this.preAppendFragment.getElementById("gee_orderstub" + err.indexPoint);
			if (stub !== null) {
				stub.classList.remove("gee_stub");
				stub.classList.add("gaf_enhance_extension_error");
				stub.textContent = "Error (+" + err.type + ") loading post at index: " + err.indexPoint;
			}
		}

		this.freePool();

		if (!(this.tolerance--) || err.fatalError) {
			chrome.runtime.sendMessage(null, {
				action : "popupUIcommand_error",
				message : (err.type == "DOM") ? "Page Structure Error" : "Load Error",
				targetTab : tabId
			});
			this.stopAllActivity();
		};
		return false;
	}

};

function addQuotedInfo(span, timesQuoted, dataString, popQuoted) {
	var anchor = document.createElement("a");
	anchor.textContent = "List the " + ((timesQuoted > 1) ? (timesQuoted + " posts") : "post") + " that quoted this post. ";
	anchor.setAttribute("data-gafenhanceindex", dataString);
	anchor.classList.add("gaf_enhance_extension_lister");
	if (popQuoted) anchor.href = "#post" + dataString; //careful with datastring structure change and / or unification of code path
	anchor.addEventListener("click", (popQuoted) ? populatedQuoters : displayQuoters, false);
	flashElement(anchor);
	span.insertBefore(anchor, span.firstChild);
	window.setTimeout(flashElement.bind(anchor),66);
};

function collapsePosts() {
	var jobId = this.getAttribute("data-gafenhancejobid");
	if (!displayJobs[jobId])
		return;
	this.classList.add("gaf_enhance_extension_clicked");

	displayJobs[jobId].postHolder.parentNode.removeChild(displayJobs[jobId].postHolder); //remove all DOM elements
	//we now have to check whether a parent exists, due to auto-populated quoted listings not having a parent. May not be necessary after unification of code paths between auto-populated and on demand listing
	if (displayJobs[displayJobs[jobId].parentJobId]) displayJobs[displayJobs[jobId].parentJobId].childJobList = displayJobs[displayJobs[jobId].parentJobId].childJobList.filter(function (jobIdItem) {
		return (jobIdItem !== jobId)
	}); // remove from parent child job lists
	nullJob(jobId); //recursively zap child job lists.

};

	function nullJob(jobId) {
		if (!displayJobs[jobId])
			return;
		displayJobs[jobId].childJobList.forEach(function (jobIdItem) {
			nullJob(jobIdItem)
		}); //recursively null every childJob.
		displayJobs[jobId] = null;
	};

	function displayQuoters() {
		var jobInfo = this.getAttribute("data-gafenhanceindex").split(":"),
		parentJobId = jobInfo[0],
		indeX = jobInfo[1],
		displayJob;
		if (!(displayJob = displayJobs[parentJobId]) || displayJobs[displayJob.idList[indeX] + "_job"]) //bail out if no parentJobId is found or there's already such a display job.
			return false;

		chrome.runtime.sendMessage(null, {
			action : "listQuotingPosts",
			threadId : threadId,
			postId : displayJob.postList[indeX][0],
			quotedId : displayJob.idList[indeX],
			parentJobId : parentJobId
		});

		return;
	};

	function populatedQuoters() {
		var postId = this.getAttribute("data-gafenhanceindex")//.split(":"),

		if (displayJobs["post"+postId + "_job"]) //bail out if there's already such a display job.
			return false;

		chrome.runtime.sendMessage(null, {
			action: "listQuotingPosts",
			threadId: threadId,
			postId: postId,
			quotedId: "post" + postId ,
			parentJobId: "populateJob" //no such parent job exists, currently.
		});

		return;
	};

	//fleXanim v1.1 beta 5 //minimal animation library by hesido.com
	var $fleXanim = {
		aeT : {},
		Prepare : function () {
			this.aeL = {};
			this.aQ = []
		}
	};

	$fleXanim.Prepare.prototype = {
		setAnimation : function (s) {
			if (!s.cachE)
				s.cachE = {
					aP : s.template.split("##"),
					fP : [],
					fr : s.frames || 25,
					ms : s.milisecs || 16,
					tw : s.tween || "smooth"
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
		setTemplate : function (s) {
			var aP = s.template.split("##");
			for (var i = 0, reg = /^\.#/, propS = '', rP; aP[i]; i++) {
				rP = s.values[i] || 0;
				propS += aP[i].replace(reg, '') + rP
			};
			s.stylE = propS;
			this.aQ.push(s);
			return this
		},
		run : function (f) {
			this.aQ.push({
				func : f
			});
			return this
		},
		forward : function (reF, pD) {
			var aE = this.aeL[reF];
			if (!aE)
				return;
			aE.pD = pD || 1;
			if (!aE.animInt)
				this.runAnim(aE.paused || (pD && pD < 0 && this.aQ.length - 1) || 0, reF);
			aE.paused = false
		},
		reverse : function (reF) {
			this.forward(reF, -1)
		},
		animate : function (reF) {
			if (!this.aeL[reF])
				this.init(reF);
			this.forward(reF)
		},
		init : function (reF) {
			this.aeL[reF] = {
				aI : 0,
				sV : [],
				eV : [],
				ref : reF,
				elm : document.getElementById(reF)
			};
			$fleXanim.aeT[reF] = $fleXanim.aeT[reF] || {};
			return this.aeL[reF]
		},
		clearAnim : function () {
			this.aQ.push({
				clear : true
			});
			return this
		},
		delay: function (dA) {
			this.aQ.push({
				delay : dA
			});
			return this
		},
		loopBegin : function () {
			this.loopStart = this.aQ.length;
			return this
		},
		loop : function (n) {
			this.aQ.push({
				doLoop : true,
				loopTimes : n || -1,
				loopStart : this.loopStart || 0
			});
			return this
		},
		setStyle : function (p) {
			this.aQ.push({
				stylE : p
			});
			return this
		},
		breakLoop : function (reF) {
			this.aeL[reF].breakOut = true
		},
		reset : function () {
			this.pause(false, true);
			this.aQ = [];
			this.aeL = {};
			return this
		},
		pause : function (reF, reset) {
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
		applyStyle : function (p, elm) {
			var sL = p.match(/[^:;]+/g);
			for (var i = 0, proP, vaL; proP = sL[i]; i += 2) {
				vaL = sL[i + 1];
				elm.style[proP] = vaL
			}
		},
		runAnim : function (inD, reF) {
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
			if (s.clear) {this.aeL[reF] = null; delete this.aeL[reF]; return;}
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
		animStep : {
			smooth : function (t, b, c, d) {
				c -= b;
				var ts = (t /= d) * t,
				tc = ts * t;
				return (b + c * (-2 * tc + 3 * ts))
			},
			easein : function (t, b, c, d) {
				c -= b;
				var ts = (t /= d) * t * t;
				return (b + c * (ts))
			},
			easeout : function (t, b, c, d) {
				c -= b;
				var ts = (t /= d) * t,
				tc = ts * t;
				return (b + c * (tc - 3 * ts + 3 * t))
			},
			linear : function (t, b, c, d) {
				c -= b;
				t /= d;
				return (b + c * (t))
			}
		}
	};
