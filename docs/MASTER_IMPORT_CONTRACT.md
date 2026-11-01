# Contrato de importación del Maestro

## Identidad de serie
Una serie se identifica por:
`publisher + title + volume_stage + start_year`

Esto corresponde a Editorial + Cabecera + Volumen/Etapa + Año de inicio.

## Reglas
1. No colapsar volúmenes/etapas/años distintos bajo una sola cabecera.
2. Un número con `issue_number` conocido solo puede existir una vez dentro de la misma serie.
3. ISBN, portada y metadatos enriquecen un número; no sustituyen la identidad editorial de la serie.
4. Casos de regresión obligatorios antes de publicar el Maestro: Spider-Man/Forum con múltiples etapas y colecciones; Batman/Novaro incluyendo Serie Águila.
5. La carga del Maestro se realiza con credenciales de backend/administración, nunca desde el navegador del cliente.
6. Tras importar: validar conteos, duplicados, series sin números, números huérfanos y muestras por editorial.
