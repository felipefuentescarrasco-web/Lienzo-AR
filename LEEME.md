# Lienzo AR

App web para calcar el boceto de la alianza sobre el lienzo usando la cámara del celular.
El dibujo se mantiene pegado al lienzo siguiendo los trazos de la imagen (flujo óptico + homografía, librería jsfeat en `vendor/`).

- `index.html`, `app.js`: la app (cámara, capas, seguimiento).
- `extras.js`: colorear (rellenar zona y pincel), colores sugeridos, fotos propias y generador de banderines / papel picado estilo Coco.
- `boceto_lineas.png`, `dibujos/`: el boceto y los dibujos (copiados de `../Proyector`). Los `*_color.*` son las sugerencias de color.
- `lienzo_demo.jpg`: foto del lienzo para probar sin cámara.

La cámara del celular solo funciona en una dirección https (por ejemplo GitHub Pages).
Para probar en el PC: `python -m http.server 8766` en esta carpeta y abrir http://localhost:8766.
