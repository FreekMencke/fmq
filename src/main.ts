import cluster from 'cluster';
import express from 'express';
import { clusterMetrics } from 'express-prom-bundle';
import { MongoClient } from 'mongodb';
import os from 'os';
import { App } from './app/app';
import { Logger } from './app/common/logger';
import { CommandHistory } from './app/queue/command-history';
import { Tasks } from './app/tasks/tasks';
import { config } from './config/config';

const mongoClient = new MongoClient(config.mongo.url,
  {
    auth: {
      username: config.mongo.user,
      password: config.mongo.password,
    },
    authSource: config.mongo.authSource,
    authMechanism: config.mongo.authMechanism,
  }
);

if (cluster.isPrimary) {
  Logger.log('FMQ ACTIVE - FORKING WORKERS');

  os.cpus().forEach(() => cluster.fork());

  const app = express();
  app.use('/metrics', clusterMetrics());
  app.listen(config.portMetrics);

  cluster.on('exit', worker => {
    Logger.log(`WORKER ${worker.id} DIED - CREATING NEW WORKER`);
    cluster.fork();
  });
} else {
  mongoClient
    .connect()
    .then(client => {
      const db = client.db('fmq');
      CommandHistory.collection(db).createIndex('hashCode', { unique: true });

      Tasks.start(db);
      App.run(db, cluster.worker!);
    })
    .catch(err => {
      Logger.log(`WORKER ${cluster.worker!.id} ERROR: ${err.message}`);
      cluster.worker!.kill();
    });
}
