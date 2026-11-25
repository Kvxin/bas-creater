def text obj_c1 {
    content = "a"
    color = 0x00ff00
    duration = 4.5s
    alpha = 0
}
set obj_c1 {} 0.5s
then set obj_c1 { alpha = 1 } 0s
then set obj_c1 { x = 0 scale = 1 alpha = 1 } 0s
then set obj_c1 { x = 200 scale = 2 alpha = 0.5 } 1s
then set obj_c1 {} 1s
then set obj_c1 { content = "b" fontSize = 40 } 0s
then set obj_c1 { x = 100 rotateZ = 90 } 1.5s
then set obj_c1 { content = "c" } 0s
