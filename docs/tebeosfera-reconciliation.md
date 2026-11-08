# Conciliación Maestro ↔ Tebeosfera

**Alcance:** todas las editoriales y ejemplares del Maestro, no solo Bruguera.

Para realizar la comparación completa se necesita una exportación CSV autorizada del Gran Catálogo de Tebeosfera. No debe eludirse ningún control de acceso ni descargarse masivamente el sitio. Solicitar a la Asociación Cultural Tebeosfera el fichero y las condiciones de reutilización de metadatos y portadas.

Columnas mínimas: `publisher,catalogHeader,issueNr`. Recomendadas: `volume,stage,startYear,isbn,title,publicationDate,coverUrl,sourceUrl,coverReuseAuthorized`.

Ejecutar:
```bash
python3 scripts/reconcile_tebeosfera.py --reference /ruta/al/tebeosfera-autorizado.csv
```

El informe se escribe en `master-data/tebeosfera-audit/` y distingue coincidencias, ausencias candidatas, ambigüedades y portadas candidatas con autorización indicada. **No cambia el Maestro ni las colecciones de usuarios.** Las altas y portadas solo podrán incorporarse después de validar la edición, las licencias y la procedencia. Si hay discrepancia de ISBN o fecha, se envía a revisión; no se fuerza el emparejamiento. Las portadas no se copian ni descargan por este proceso.
