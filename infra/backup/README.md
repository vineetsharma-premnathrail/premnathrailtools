# Daily DB backup to SharePoint

Runs on the production VPS from root's cron. No PC needed.

```
02:00 cron -> backup.sh
  pg_dump -Fc inside the Postgres container (+ pg_dumpall --globals-only for roles)
  -> validate: alembic_version present, >= MIN_TABLES tables (catches an empty / wrong DB)
  -> gpg AES-256 encrypt, decrypt-and-compare check
  -> upload.py: SharePoint "<SHAREPOINT_BACKUP_FOLDER>/Daily" (+Weekly on Sunday, +Monthly on the 1st)
     chunked upload (any size), size verified, old copies pruned (30 / 12 / 12)
  -> local copies older than 7 days deleted, only if they were uploaded
  any failure -> Teams alert (ALERT_WEBHOOK_URL) + log, local file kept
```

Uses the ERP app registration (`AZURE_*`, `SHAREPOINT_SITE_ID` from the Dokploy env). No DB password is stored here:
the scripts use the container's own `POSTGRES_USER` / `POSTGRES_PASSWORD`.

## Install (once, on the VPS, as root)

```bash
sudo apt install -y gnupg python3 curl            # usually already present
sudo mkdir -p /opt/premnath-backup /var/backups/premnathrail
sudo chmod 700 /opt/premnath-backup /var/backups/premnathrail
# copy backup.sh common.sh restore.sh upload.py .env.example into /opt/premnath-backup
cd /opt/premnath-backup
sudo cp .env.example .env && sudo chmod 600 .env && sudo nano .env
sudo chmod 700 backup.sh restore.sh upload.py

# Encryption key: generate once, then store a copy in the company password manager.
# Without this key the backups cannot be opened.
sudo sh -c 'umask 077; openssl rand -base64 48 > /root/.premnath-backup.key'
sudo cat /root/.premnath-backup.key               # copy into the password manager, then clear the screen

sudo python3 upload.py check                      # Azure login + SharePoint folders
sudo ./backup.sh                                  # first real run
sudo python3 upload.py list
```

Schedule (`sudo crontab -e`). Check `timedatectl` first: if the VPS runs on UTC, 02:00 IST is `30 20 * * *`.

```
0 2 * * * /opt/premnath-backup/backup.sh >> /var/log/premnath-backup.log 2>&1
```

Log rotation, `/etc/logrotate.d/premnath-backup`:

```
/var/log/premnath-backup.log { monthly rotate 12 compress missingok notifempty }
```

## Restore

Always into a new database first. `restore.sh` refuses to overwrite `DB_NAME`.

```bash
cd /opt/premnath-backup
sudo python3 upload.py list Daily
sudo python3 upload.py download Daily premnathrail_db_<stamp>.dump.gpg /var/backups/premnathrail   # if not local
sudo ./restore.sh /var/backups/premnathrail/premnathrail_db_<stamp>.dump.gpg premnathrail_restored
```

It prints alembic revision, table count and user count for the restored copy and the live DB.
To make the restored copy live, change the DB name in `DATABASE_URL` in Dokploy and redeploy.
Take a fresh backup of the current DB before switching.

Roles (only needed on a brand-new Postgres server):

```bash
gpg --batch --pinentry-mode loopback --passphrase-file /root/.premnath-backup.key \
    -d premnathrail_globals_<stamp>.sql.gpg | docker exec -i <container> psql -U <user> -d postgres
```

On a machine without the scripts (e.g. a new VPS): `gpg -d file.dump.gpg > file.dump` (asks for the key),
then `pg_restore -d <new_db> --no-owner --no-privileges file.dump`.

## Checks

- Monthly: run `restore.sh` on the newest backup, compare the counts, drop the test DB.
- Azure client secret expiry: when the ERP secret is rotated in Dokploy, update `.env` here too.
- Attachments are already in SharePoint (`ERP-media`) and are not part of this backup.
