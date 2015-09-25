// NeoGAF Thread Summarizer Copyright (c) 2015 hesido.com
"use strict";

var cacheset,
usecache,
cachelim,
analimit,
statusms,
usecaclb,
pagemodi,
onpageac,
usecachesetting,
receivedsettings = false,
settings = {
	settingsVersion: 1.1,
	cachepages: true,
	usecacheforanalysis: true,
	pagecachetimelimit: 15,
	analysiscachetimelimit: 15,
	populatepages: true,
	onpageactions: true,
}; //set defaults first without waiting for the local storage callback just in case; //set defaults first without waiting for the local storage callback just in case


function save_options() {
	if (!settings) return;
	settings = {
		settingsVersion: 1.1,
		cachepages : cacheset.checked,
		usecacheforanalysis : usecachesetting, //this setting will not be directly tied to the on-screen checked status.
		pagecachetimelimit : cachelim.value || settings.pagecachetimelimit,
		analysiscachetimelimit: analimit.value || settings.analysiscachetimelimit,
		populatepages: pagemodi.checked,
		onpageactions: onpageac.checked
	};
	chrome.storage.sync.set(settings, function () {
		// Update status to let user know options were saved.
		chrome.runtime.sendMessage(null, {
			action : "receiveSettings",
			settings : settings,
			saved : true
		});
		statusms.textContent = 'Status: Saved settings.';
		setTimeout(function () {
			statusms.textContent = 'Status: Waiting for changes.';
		}, 500);
	});
}

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
function restore_options() {
	cacheset = document.getElementById('cachepage');
	usecache = document.getElementById('usecachepages');
	cachelim = document.getElementById('pagecachetimelimit');
	analimit = document.getElementById('analysiscachetimelimit');
	statusms = document.getElementById('status');
	usecaclb = document.getElementById('usecachepages_label');
	pagemodi = document.getElementById('dopagemod');
	onpageac = document.getElementById('onpageactions');

	chrome.storage.sync.get(
		settings, function (savedSettings) {
		usecachesetting = savedSettings.usecacheforanalysis;
		cacheset.checked = savedSettings.cachepages;
		usecache.checked = cacheset.checked && usecachesetting;
		cachelim.value = savedSettings.pagecachetimelimit;
		analimit.value = savedSettings.analysiscachetimelimit;
		pagemodi.checked = savedSettings.populatepages;
		onpageac.checked = savedSettings.onpageactions;

		settings = savedSettings;

		if (!cacheset.checked) {
			usecaclb.classList.add("disabled");
			usecache.disabled = true;
		}

		cacheset.addEventListener("change", saved_status);
		usecache.addEventListener("change", saved_status);
		cachelim.addEventListener("change", saved_status);
		analimit.addEventListener("change", saved_status);
		pagemodi.addEventListener("change", saved_status);
		onpageac.addEventListener("change", saved_status);

		statusms.textContent = 'Status: Waiting for changes.';
		document.getElementById('save').disabled = false;
	});
}

function saved_status(e) {
	if (e.srcElement.id == "cachepage") {
		if (!cacheset.checked) {
			usecachesetting = usecache.checked;
			usecache.disabled = true;
			usecache.checked = false;
			usecaclb.classList.add("disabled");
		} else {
			usecache.disabled = false;
			usecache.checked = usecachesetting;
			usecaclb.classList.remove("disabled");
		};
	};

	if (e.srcElement.id == "usecachepages") {
		usecachesetting = usecache.checked; //only change the setting when user actively selects it.
	}

	statusms.textContent = "Status: Changed settings, not yet saved."
};

document.addEventListener('DOMContentLoaded', restore_options);
document.getElementById('save').addEventListener('click', save_options);
