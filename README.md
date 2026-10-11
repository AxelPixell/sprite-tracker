# Spiritelli Tracker

Web app per tenere traccia degli spiritelli di Fortnite. Funziona senza server: è composta da tre file statici (hostabili su GitHub Pages) e usa **Firebase** (Authentication con Google + Firestore) per login e database.

## File del progetto

| File | Contenuto |
|---|---|
| `index.html` | Struttura della pagina, librerie esterne (SheetJS per import/export, jsPDF per il PDF) e un piccolo script di diagnostica |
| `style.css` | Stile. In cima c'è il blocco `TEMA STAGIONALE` con i colori e le dimensioni da cambiare ad ogni stagione |
| `app.js` | Tutta la logica: Firebase, interfaccia, funzioni admin, amici, PDF, log |
| `import_prova.csv` | File di esempio per l'import (Jonesy e Avventura, varianti base, oro, trucchi, hacker, cacciatore) |

## Configurazione

1. **Firebase:** crea un progetto su console.firebase.google.com e aggiungi un'app Web.
2. **Authentication:** abilita il provider **Google** e, in *Impostazioni > Domini autorizzati*, aggiungi il dominio di GitHub Pages (es. `tuonome.github.io`).
3. **Firestore:** crea il database e incolla le regole riportate più sotto.
4. **`app.js`:** nel blocco `FIREBASE_CONFIG` sostituisci i valori `INCOLLA_QUI` con quelli della tua app web. Cambia solo i valori tra virgolette: non incollare le righe `import` dello snippet della console Firebase.
5. **Admin:** in `app.js` scrivi le email degli admin in `ADMIN_EMAILS`. Devono coincidere con quelle nelle regole Firestore.
6. **Pubblicazione:** carica i file nel repository e attiva *Settings > Pages*.

Le chiavi web di Firebase non sono segrete: la sicurezza è garantita dalle regole Firestore.

### Regole Firestore consigliate

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function isAdmin() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email in ['tuamail@gmail.com'];
    }
    match /sprites/{id} { allow read: if true; allow write: if isAdmin(); }
    match /config/{id}  { allow read: if true; allow write: if isAdmin(); }
    match /log/{id}     { allow read, create: if isAdmin(); }
    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Note di sicurezza:
- La lista `ADMIN_EMAILS` in `app.js` serve solo a mostrare i pulsanti admin: chi può davvero scrivere è deciso dalle regole.
- Ogni utente loggato può leggere il profilo di chi conosce per UID (nome, amici, stati); l’elenco completo degli utenti non è consultabile. Condividi il tuo UID solo con chi vuoi.
- Facoltativo: in Google Cloud > Credenziali puoi limitare la chiave API al tuo dominio e impostare un avviso di budget.

## Come funziona

### Per tutti i visitatori
- L'elenco globale degli spiritelli è visibile anche senza login. Le varianti non possedute appaiono oscurate (il nome della variante resta del suo colore, ben leggibile).
- Ogni spiritello ha una riga con l'avatar e una casella per ogni variante.

### Per gli utenti loggati (Google)
- **Stati:** un click o tap su una variante la fa passare da *non posseduta* a *posseduta* (✓), poi a *incoronata* (👑), poi di nuovo a *non posseduta*. L'utente salva solo il proprio stato.
- **Filtro:** *Tutti*, *Solo posseduti*, *Solo mancanti*. Il filtro agisce sulle singole varianti: in ogni riga restano visibili solo quelle possedute (o mancanti). Una variante appena toccata resta visibile finché non si cambia filtro.
- **Amici:** si aggiungono tramite UID (visibile nella finestra *👥 Amici*). Sotto ogni variante compaiono i nomi degli amici che la possiedono (incoronata vale come posseduta), in un colore sempre leggibile anche se la variante dell'utente è oscurata.
- **PDF:** *📄 PDF* esporta la lista personale (incoronati, posseduti e mancanti per ogni spiritello). Si può condividere su WhatsApp o Discord (da smartphone si apre il menu di condivisione; da PC il PDF viene scaricato e si apre l'app) oppure salvare sul dispositivo.

### Per gli admin
- **＋ Spiritello:** crea una riga con nome, URL dell'avatar e varianti presenti.
- **✎ / 🗑 su ogni riga:** modifica nome, avatar e varianti dello spiritello, oppure lo elimina.
- **🎨 Varianti:** le varianti sono globali, cioè hanno lo stesso nome e colore per tutti gli spiritelli.
  - modifica di nome e colore di ogni variante;
  - creazione di una nuova variante, con l'opzione di aggiungerla a tutti gli spiritelli esistenti;
  - eliminazione di una variante (viene tolta da tutti gli spiritelli);
  - **riordino a trascinamento** con la maniglia ⠿ (mouse e touch). L'ordine vale per tutti gli spiritelli e non tocca i dati degli utenti.
- **⬆ Importa:** carica un elenco da file `txt`, `csv`, `xlsx` o `ods`.
- **⬇ Esporta:** scarica il database globale in `csv`, `txt`, `xlsx` o `ods`, utile come backup.
- **📜 Log:** mostra le ultime 5 modifiche.

### Formato del file di import
Una riga per spiritello, con campi separati da `;`, tab o virgola:

```
Nome; URL avatar (oppure -); variante1; variante2; ...
```

- `-` indica un URL vuoto. Il numero di varianti può essere diverso da riga a riga. La riga di intestazione è facoltativa.
- Le varianti **sostituiscono** quelle precedenti: dopo l'import l'elenco varianti contiene solo quelle presenti nel file, nell'ordine in cui compaiono. Nome e colore di una variante già esistente con lo stesso nome vengono mantenuti.
- Gli spiritelli seguono l'**ordine del foglio**, non quello alfabetico.
- La casella *Elimina gli spiritelli non presenti nel file* (spenta di default) permette di sostituire completamente l'elenco. Se è spenta, gli spiritelli non presenti nel file restano in fondo all'elenco, senza le varianti vecchie.

### Log delle modifiche
Visibile solo agli admin. Registra: caricamento di una nuova lista, aggiunta di una variante (nome e colore), modifica ed eliminazione di una variante, aggiunta ed eliminazione di uno spiritello, modifica di uno spiritello (cambio nome, avatar, varianti aggiunte o eliminate).

## Struttura dei dati (Firestore)

- `sprites/{id}`: `name`, `avatar`, `variants` (lista di chiavi), `order` (posizione nell'elenco)
- `config/variants`: `list`, elenco globale ordinato di `{key, name, color}`
- `users/{uid}`: `name`, `friends` (lista di UID), `states` (chiave `idSpiritello__chiaveVariante` con valore 1 = posseduto, 2 = incoronato; assente = non posseduto)
- `log/{id}`: `text`, `ts`, `by`

Gli stati degli utenti usano la chiave della variante, non la sua posizione né il suo nome: cambiare ordine, nome o colore di una variante non altera i dati salvati dagli utenti.

## Cronologia delle modifiche

1. **Prima versione:** interfaccia pubblica con spiritelli oscurati, login Google, stati non posseduto / posseduto / incoronato, varianti con colore globale, amici via UID, PDF con condivisione, funzioni admin (spiritelli, varianti, import ed export in vari formati), stile modificabile da `style.css`.
2. **Filtro corretto:** il filtro *posseduti / mancanti* ora agisce sulle singole varianti e non sull'intero spiritello, perché prima quasi tutte le righe comparivano in entrambi i filtri.
3. **Riordino delle varianti:** trascinamento nella finestra *Varianti*, con ordine globale salvato. Il nome della variante resta leggibile anche quando è oscurata.
4. **Import e log:** l'import sostituisce le varianti con quelle del nuovo file, mantiene l'ordine del foglio e offre la sostituzione completa dell'elenco. Aggiunta la sezione *Log* con le ultime 5 modifiche. Nella modifica di uno spiritello ora si può cambiare anche il nome.
5. **Diagnostica:** se Firestore non risponde, rifiuta la lettura o `app.js` non parte, la pagina mostra un messaggio d'errore invece del caricamento infinito.

## Risoluzione dei problemi

- **Caricamento infinito:** controlla la console del browser (F12). Cause tipiche: chiavi in `FIREBASE_CONFIG` errate o righe `import` incollate per sbaglio, deploy di GitHub Pages non ancora terminato (scheda *Actions*), regole Firestore che bloccano la lettura.
- **Pulsanti admin assenti:** l'email dell'account deve essere identica in `ADMIN_EMAILS` e nelle regole Firestore.
- **Log vuoto o non salvato:** verifica di aver aggiunto il blocco `match /log/{id}` alle regole.
- **Login Google che non si apre:** controlla che il dominio di GitHub Pages sia tra i *Domini autorizzati* di Authentication.
