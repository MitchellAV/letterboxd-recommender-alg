const puppeteer = require("puppeteer-extra");
const cheerio = require("cheerio");

const StealthPlugin = require("puppeteer-extra-plugin-stealth");

const AdblockerPlugin = require("puppeteer-extra-plugin-adblocker");
puppeteer.use(AdblockerPlugin());
puppeteer.use(StealthPlugin());
const Movie = require("../models/movie");
const browser_settings = {
	headless: true,
	args: ["--no-sandbox", "--disable-setuid-sandbox"]
};

const get_movie_info = async (browser, $, el) => {
	const movie = {
		_id: null,
		letterboxd_id: null,
		letterboxd_url: null,
		rating: null
	};

	let letterboxd_id = $(el).find("div").attr("data-film-id");
	letterboxd_id = parseInt(letterboxd_id);
	movie.letterboxd_id = letterboxd_id;
	const letterboxd_url = $(el).find("div").attr("data-film-link");
	movie.letterboxd_url = letterboxd_url;

	let film_rating_class = $(el).find("span.rating");

	if (film_rating_class.length !== 0) {
		film_rating_class = $(film_rating_class).attr("class").split(" ").pop();
		const film_rating = parseInt(film_rating_class.split("-").pop());
		movie.rating = film_rating;
	}

	let id_found_in_database = await Movie.find({
		letterboxd_id: letterboxd_id
	}).lean();
	id_found_in_database = id_found_in_database[0];
	if (!id_found_in_database && letterboxd_url) {
		const moviePage = await browser.newPage();
		const movieUrl = `https://letterboxd.com${letterboxd_url}`;

		await moviePage.goto(movieUrl, {
			waitUntil: "load",
			timeout: 5 * 60 * 1000
		});

		const movieContent = await moviePage.content();

		const $m = cheerio.load(movieContent);

		const film_id = parseInt($m("body").attr("data-tmdb-id"));
		movie._id = film_id;
		try {
			await Movie.updateOne(
				{ _id: film_id },
				{
					letterboxd_id: letterboxd_id,
					letterboxd_url: letterboxd_url
				}
			);
		} catch (err) {
			console.log("movie does not exist in database");
		}

		await moviePage.close();
	} else {
		movie._id = id_found_in_database._id;
	}
	return movie;
};

const get_movies_from_page = async (children, browser, $) => {
	let promises = [];
	let maxAsync = 5;
	let movies = [];
	for (let i = 0; i < children.length; i++) {
		const el = children[i];
		promises.push(get_movie_info(browser, $, el));
		if (promises.length === maxAsync) {
			let movies_from_page = await Promise.all(promises);
			promises = [];
			movies = movies.concat(movies_from_page);
		}
	}
	if (promises.length !== 0) {
		let movies_from_page = await Promise.all(promises);
		movies = movies.concat(movies_from_page);
	}
	return movies;
};

const getLetterboxdUserMovies = async (user) => {
	let output = [];
	try {
		const browser = await puppeteer.launch(browser_settings);
		const page = await browser.newPage();
		let pagenum = 1;
		let finished = false;
		let promises = [];
		let maxAsync = 5;
		while (!finished) {
			const url = `https://letterboxd.com/${user}/films/page/${pagenum}`;

			await page.goto(url, { waitUntil: "load" });

			const content = await page.content();

			const $ = cheerio.load(content);

			const children = $("ul.poster-list").children();
			if (children.length !== 0) {
				promises.push(get_movies_from_page(children, browser, $));
			} else {
				console.log("No more movies left.");
				finished = true;
			}
			if (promises.length === maxAsync) {
				let movies_from_pages = await Promise.all(promises);
				promises = [];
				output = output.concat(movies_from_pages.flat());
			}
			pagenum++;
		}
		if (promises.length !== 0) {
			let movies_from_pages = await Promise.all(promises);
			promises = [];
			output = output.concat(movies_from_pages.flat());
		}
		await browser.close();
		console.log("Finished getting movies from user.");
		return output;
	} catch (err) {
		console.error(err);
	}
};

const isRealLetterboxdUser = async (user) => {
	let userfound = false;
	try {
		const browser = await puppeteer.launch(browser_settings);

		const page = await browser.newPage();

		const url = `https://letterboxd.com/${user}/films/`;

		await page.goto(url, { waitUntil: "load" });

		const content = await page.content();

		const $ = cheerio.load(content);

		const exists = $(".poster-list").length;
		if (exists !== 0) userfound = true;

		await browser.close();
		return userfound;
	} catch (err) {
		console.error(err);
	}
};

module.exports = { getLetterboxdUserMovies, isRealLetterboxdUser };
