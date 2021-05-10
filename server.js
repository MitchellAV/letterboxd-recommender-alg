const dotenv = require("dotenv").config();
const express = require("express");
const cors = require("cors");

const mongoose = require("mongoose");
const Movie = require("./models/movie");

const app = express();

app.use(cors());

// Body Parser Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Routes
app.use("/api", require("./routes/api"));
app.use((err, req, res, next) => {
	console.error(err);
	res.status(err.status).json(err);
});

mongoose
	.connect(process.env.MONGODB_URI, {
		useNewUrlParser: true,
		useUnifiedTopology: true,
		useFindAndModify: false,
		useCreateIndex: true
	})
	.then(async (result) => {
		console.log("Sucessfully Connected to MongoDB Atlas Database");
		const MOVIES = await Movie.aggregate([
			{
				$lookup: {
					from: "tags",
					localField: "tags",
					foreignField: "_id",
					as: "tags"
				}
			},
			{
				$set: {
					tags: {
						$map: {
							input: "$tags",
							as: "el",
							in: {
								_id: "$$el._id",
								idf: "$$el.idf"
							}
						}
					}
				}
			}
		]);

		console.log("Movies loaded");
		app.set("MOVIES", MOVIES);
		app.listen(
			process.env.PORT || 8080,
			console.log("Server started on localhost:3000")
		);
	})
	.catch((err) => console.error(err));
