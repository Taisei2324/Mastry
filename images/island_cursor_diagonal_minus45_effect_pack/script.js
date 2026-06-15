const cursor = document.getElementById("customCursor");
const burst = document.getElementById("loadingBurst");

let x = innerWidth / 2;
let y = innerHeight / 2;
let cx = x;
let cy = y;

function move(e) {
  x = e.clientX;
  y = e.clientY;
}

function loop() {
  cx += (x - cx) * 0.32;
  cy += (y - cy) * 0.32;

  cursor.style.transform = `translate3d(${cx - 36}px, ${cy - 36}px, 0)`;

  requestAnimationFrame(loop);
}

function triggerLoadingEffect(e) {
  const px = e?.clientX ?? cx;
  const py = e?.clientY ?? cy;

  burst.style.left = `${px}px`;
  burst.style.top = `${py}px`;

  burst.classList.remove("active");
  void burst.offsetWidth;
  burst.classList.add("active");
}

addEventListener("pointermove", move, { passive: true });
addEventListener("pointerdown", triggerLoadingEffect);
document.querySelectorAll("a, button").forEach(el => {
  el.addEventListener("mouseenter", triggerLoadingEffect);
});

loop();
