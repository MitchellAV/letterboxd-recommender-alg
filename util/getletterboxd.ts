import cheerio from "cheerio";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
puppeteer.use(AdblockerPlugin());
puppeteer.use(StealthPlugin());

import Movie from "../models/movie";
import { Browser } from "puppeteer";
import { Movie as MovieType } from "../util/types";

const browser_settings = {
	headless: true,
	args: ["--no-sandbox", "--disable-setuid-sandbox"]
};
interface LetterboxdMovie {
	_id: number | null;
	letterboxd_id: number | null;
	letterboxd_url: string | null;
	rating: number | null;
}

const get_film_id = async (
	browser: Browser,
	letterboxd_url: string,
	letterboxd_id: number
) => {
	const moviePage = await browser.newPage();
	const movieUrl = `https://letterboxd.com${letterboxd_url}`;

	await moviePage.goto(movieUrl, {
		waitUntil: "load",
		timeout: 60 * 1000
	});

	const movieContent = await moviePage.content();

	const $ = cheerio.load(movieContent);

	let film_id = $("body").attr("data-tmdb-id");
	if (film_id) {
		try {
			await Movie.updateOne(
				{ _id: film_id },
				{
					letterboxd_id,
					letterboxd_url
				}
			);
		} catch (err) {
			console.log("movie does not exist in database");
			console.error(err);
		}
	}

	await moviePage.close();
	return film_id;
};

const get_movie_info = async (
	browser: Browser,
	$: cheerio.Root,
	el: cheerio.Element
) => {
	const movie: LetterboxdMovie = {
		_id: null,
		letterboxd_id: null,
		letterboxd_url: null,
		rating: null
	};

	const letterboxd_id = $(el).find("div").attr("data-film-id");
	if (letterboxd_id) movie.letterboxd_id = parseInt(letterboxd_id);

	const letterboxd_url = $(el).find("div").attr("data-film-link");
	if (letterboxd_url) movie.letterboxd_url = letterboxd_url;

	let film_rating_el = $(el).find("span.rating");

	if (film_rating_el.length !== 0) {
		const film_rating_class = $(film_rating_el).attr("class");
		if (film_rating_class) {
			let film_rating_string = film_rating_class.split(" ").pop();
			if (film_rating_string) {
				let film_rating = film_rating_string.split("-").pop();
				if (film_rating) {
					movie.rating = parseInt(film_rating);
				}
			}
		}
	}

	const movie_in_database: MovieType = (
		await Movie.find({
			letterboxd_id: letterboxd_id
		}).lean()
	)[0];

	if (!movie_in_database && letterboxd_url && letterboxd_id) {
		try {
			const film_id = await get_film_id(
				browser,
				letterboxd_url,
				parseInt(letterboxd_id)
			);
			if (film_id) movie._id = parseInt(film_id);
		} catch (err) {
			console.log(err);
		}
	} else {
		movie._id = movie_in_database._id;
	}
	return movie;
};

const get_movies_from_page = async (
	children: cheerio.Cheerio,
	browser: Browser,
	$: cheerio.Root
) => {
	let promises: Promise<LetterboxdMovie>[] = [];
	let maxAsync = 3;
	let movies: LetterboxdMovie[] = [];
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

export const getLetterboxdUserMovies = async (username: string) => {
	let output: LetterboxdMovie[] = [];
	let pageNum = 1;
	let finished = false;
	let promises: Promise<LetterboxdMovie[]>[] = [];
	let maxAsync = 5;
	let maxPages = 1;
	const browser = await puppeteer.launch(browser_settings);
	const page = await browser.newPage();

	do {
		const url = `https://letterboxd.com/${username}/films/page/${pageNum}`;

		await page.goto(url, {
			waitUntil: "load",
			timeout: 30 * 1000
		});

		const content = await page.content();

		const $ = cheerio.load(content);
		if (pageNum === 1) {
			maxPages = parseInt($(".paginate-pages>ul>li:last-child>a").text());
		}

		if (pageNum <= maxPages) {
			const children = $("ul.poster-list").children();
			promises.push(get_movies_from_page(children, browser, $));
		} else {
			console.log("No more movies left.");
			finished = true;
		}
		if (promises.length === maxAsync) {
			let movies_from_pages = await Promise.all(promises);
			promises = [];
			output = output.concat(
				movies_from_pages.reduce((acc, val) => acc.concat(val), [])
			);
		}
		pageNum++;
	} while (!finished);

	if (promises.length !== 0) {
		let movies_from_pages = await Promise.all(promises);
		promises = [];
		output = output.concat(
			movies_from_pages.reduce((acc, val) => acc.concat(val), [])
		);
	}
	await browser.close();
	console.log("Finished getting movies from user.");
	return output;
};

export const isRealLetterboxdUser = async (username: string) => {
	let userFound = false;

	const browser = await puppeteer.launch(browser_settings);
	const page = await browser.newPage();

	const url = `https://letterboxd.com/${username}/films/`;

	await page.goto(url, { waitUntil: "load" });

	const content = await page.content();

	const $ = cheerio.load(content);

	const exists = $(".poster-list").length;
	if (exists !== 0) userFound = true;

	await browser.close();
	return userFound;
};
