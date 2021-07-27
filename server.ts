import { NextFunction, Request, Response } from "express";
import { Error } from "./util/types";
import express from "express";
import cors from "cors";
require("dotenv").config();
import Movie from "./models/movie";
import mongoose from "mongoose";

const app = express();

app.use(cors());

// Body Parser Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Routes
app.use("/", require("./routes/api"));
app.use("/", require("./routes/movie"));

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
	console.error(err);
	return res.status(err.status).json(err);
});

mongoose
	.connect(process.env.MONGODB_URI as string, {
		useNewUrlParser: true,
		useUnifiedTopology: true,
		useFindAndModify: false,
		useCreateIndex: true
	})
	.then(async () => {
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
		console.log(MOVIES[0]);

		console.log("Movies loaded");
		app.set("MOVIES", MOVIES);
		app.listen(process.env.PORT || 8080, () =>
			console.log(`Server started on port ${process.env.PORT || 8080}`)
		);
	})
	.catch((err) => console.error(err));
